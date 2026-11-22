#!/usr/bin/env bash
# SubDesk API — bootstrap OIDC via AWS CLI (Fase 04, T-03; alternativa al wizard de consola)
# Ejecuta SOLO bootstrap: provider OIDC (si falta) + rol SubDeskCiDeployRole + su policy inline.
# NO despliega nada: el despliegue es exclusivo de la pipeline (D-42/I6). Esto es una vez, a mano, con tus credenciales.
#
# Uso:  edita las 4 variables -> aws sts get-caller-identity (confirmar cuenta) -> bash bootstrap-oidc-cli.sh
# Requiere: AWS CLI v2, credenciales con permisos IAM (CreateRole/PutRolePolicy) — las tuyas propias, nunca en el repo.
# Idempotente: si el provider existe no lo recreate; si el rol existe actualiza el trust y re-put la policy.
set -euo pipefail

# ============================= EDITAR =============================
ACCOUNT_ID="159177056493"                                  # tu cuenta (la del provider)
GITHUB_ORG_REPO="Pathles5/subdesk-api"                    # owner/repo (cuenta personal: el usuario = "org")
GITHUB_ENVIRONMENT="dev"                                  # environment de GitHub: scope de secretos + claim OIDC (D-45 nombre; D-48: SIN required reviewers, el visto es el push)
REGION="us-east-1"
# ===================================================================

ROLE_NAME="SubDeskCiDeployRole"
POLICY_NAME="SubDeskCiDeployPolicy"
ISSUER="token.actions.githubusercontent.com"

# Sanity: confirmar que vas contra la cuenta correcta ANTES de crear nada
CURRENT="$(aws sts get-caller-identity --query Account --output text)"
if [ "$CURRENT" != "$ACCOUNT_ID" ]; then
  echo "ABORT: la sesión aws apunta a la cuenta $CURRENT, no a $ACCOUNT_ID. Revisa tus credenciales." >&2
  exit 1
fi
echo "Cuenta confirmada: $CURRENT ($REGION). Region de destino: us-east-1."

# ---- 1) Provider OIDC (idempotente: crea solo si no existe) ----
if ! aws iam list-open-id-connect-providers --query "OpenIDConnectProviderList[?Arn=='arn:aws:iam::$ACCOUNT_ID:oidc-provider/$ISSUER']" --output text | grep -q "$ISSUER"; then
  echo "Creando provider OIDC $ISSUER (aud sts.amazonaws.com)..."
  # Huella del certificado actual, CALCULADA en vivo (la de GitHub rota con el tiempo; hardcodearla seria un bug portatil).
  THUMB="$(echo | openssl s_client -servername "$ISSUER" -connect "$ISSUER:443" 2>/dev/null \
           | openssl x509 -fingerprint -sha1 -noout 2>/dev/null \
           | sed -E 's/.*Fingerprint=([0-9A-F:]+).*/\1/' | tr -d ':')"
  if [ -z "$THUMB" ]; then
    echo "ABORT: no se pudo calcular la huella OIDC (openssl o red). Crea el provider desde la consola (la consola la calcula sola)." >&2
    exit 1
  fi
  echo "  huella calculada: $THUMB"
  URL_ARN="$(aws iam create-open-id-connect-provider \
    --url "https://$ISSUER" \
    --client-id-list sts.amazonaws.com \
    --thumbprint-fingerprint "$THUMB" \
    --query OpenIDConnectProviderArn --output text)"
  echo "  provider: $URL_ARN"
else
  echo "Provider OIDC ya existe (paso 1 previo): ok, no se recreate."
fi

# ---- 2) Trust policy (el candado D-43/D-45: solo ESTE repo + ESTE environment) ----
TRUST="$(cat <<JSON
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Principal": { "Federated": "arn:aws:iam::$ACCOUNT_ID:oidc-provider/$ISSUER" },
      "Action": "sts:AssumeRoleWithWebIdentity",
      "Condition": {
        "StringEquals": {
          "$ISSUER:aud": "sts.amazonaws.com",
          "$ISSUER:sub": "repo:$GITHUB_ORG_REPO:environment:$GITHUB_ENVIRONMENT"
        }
      }
    }
  ]
}
JSON
)"

echo "Creando rol $ROLE_NAME (o recreando el trust si ya existía)..."
# OJO: se pasa el JSON INLINE (el CLI lo acepta como documento literal). Usar file:///tmp/... se rompe
# en Git Bash/MSYS (el aws.exe nativo no ve el /tmp de bash) — bug detectado en el dev el 2026-11-22.
if aws iam get-role --role-name "$ROLE_NAME" >/dev/null 2>&1; then
  echo "  el rol ya existe: actualizando SOLO el trust (no toca la policy inline)."
  aws iam update-assume-role-policy --role-name "$ROLE_NAME" --policy-document "$TRUST"
else
  aws iam create-role --role-name "$ROLE_NAME" \
    --assume-role-policy-document "$TRUST" \
    --description "Assumido por GitHub Actions (environment $GITHUB_ENVIRONMENT) para desplegar el stack subdesk-api-dev" \
    --tags Key=Project,Value=subdesk-api >/dev/null
fi

# ---- 3) Policy inline (permiso minimo, prefijos por stack; bloque C del bootstrap) ----
# A-03/D-48 (2026-11-22, Fase 04 T-07 pre-flight). The live policy of an EARLIER run of this script
# did not cover what CloudFormation itself calls when it provisions template.yaml: sam deploy is
# invoked WITHOUT --role-arn, so CFN authorizes every per-resource call against the CI role's own
# session (AWS docs, "using-iam-servicerole": by default CFN uses a temporary session generated from
# your credentials). Had we shipped run #3 as-is it would have died on ApiLogGroup (CREATE_FAILED)
# AND on its own rollback (no logs:DeleteLogGroup) -> an orphan ROLLBACK_FAILED stack the pipeline
# could not clean. Every addition is mapped to a resource in template.yaml, source-verified against
# the SAM CLI v1.174.0 call graph + the AWS Service Authorization Reference:
#   * ApiLogGroup (RetentionInDays: 30 + Tags)  -> logs:CreateLogGroup, logs:PutRetentionPolicy
#     (retention is NOT a CreateLogGroup parameter), logs:TagResource (CreateLogGroup with tags
#     requires it), logs:DeleteLogGroup (destroy + rollback).
#   * TicketApiFunction Tags (cost allocation)  -> lambda:TagResource (CreateFunction's authorization
#     row demands it even though Tags travel inside CreateFunction) + lambda:ListTags (GetFunction is
#     authorized by GetFunction AND ListTags, and sam/smoke read the function).
#   * bucket tagging step in deploy.yml         -> s3:PutBucketTagging (the step stops being
#     decorative).
# Deliberately NOT granted (each one is conditional or unsupported by the sources, and granting an
# action "just in case" is what this file is meant to avoid):
#   cloudformation:ValidateTemplate  - no command in this pipeline calls it (package_context.py and
#                                      deployer.py verified in v1.174.0); it would also need "*".
#   cloudformation:ListStacks        - REMOVED (it was in the earlier draft): a LIST action has no
#                                      resource-level permissions, so inside a stack-ARN Sid it was
#                                      inert; nothing calls it (deployer.py always passes StackName).
#   logs:TagLogGroup / logs|lambda:UntagResource - doc allows TagResource OR TagLogGroup; Untag* only
#                                      matters when a tag is REMOVED. Not needed by the pinned,
#                                      static Tags of template.yaml. Add on a concrete AccessDenied.
#   s3:GetBucketLocation / ListAllMyBuckets - not in the v1.174.0 graph with an explicit --s3-bucket
#                                      (that is D-15's choice; --resolve-s3 would need far more).
#   s3:DeleteObject / DeleteBucket   - prune.yml uses `aws cloudformation delete-stack` (NOT
#                                      `sam delete`): strictly fewer permissions, and the artifacts
#                                      bucket self-cleans via the 30-day lifecycle.
#   s3:AbortMultipartUpload          - the transfer manager only goes multipart at >= 8 MB per
#                                      object; the verified artifact is 856 KB (F03 spike D-31). NOTE
#                                      for F09: if prod deps ever push the ZIP past 8 MB, grant it or
#                                      fail the package-lambda size assert first.
#   iam:PassRole keeps iam:PassedToService = lambda.amazonaws.com (the live policy of run #2 predated
#                                      this line; re-running step 2/3 restores it).
POLICY="$(cat <<JSON
{
  "Version": "2012-10-17",
  "Statement": [
    { "Sid": "CloudFormation", "Effect": "Allow", "Action": ["cloudformation:CreateChangeSet","cloudformation:DescribeChangeSet","cloudformation:ExecuteChangeSet","cloudformation:DescribeStacks","cloudformation:DescribeStackEvents","cloudformation:GetTemplateSummary","cloudformation:DeleteStack"], "Resource": "arn:aws:cloudformation:us-east-1:$ACCOUNT_ID:stack/subdesk-api-dev/*" },
    { "Sid": "SAMArtifactBucket", "Effect": "Allow", "Action": ["s3:CreateBucket","s3:PutObject","s3:GetObject","s3:ListBucket","s3:PutEncryptionConfiguration","s3:PutLifecycleConfiguration","s3:PutBucketTagging"], "Resource": ["arn:aws:s3:::aws-sam-cli-managed-*", "arn:aws:s3:::aws-sam-cli-managed-*/*"] },
    { "Sid": "LambdaScoped", "Effect": "Allow", "Action": ["lambda:CreateFunction","lambda:GetFunction","lambda:UpdateFunctionCode","lambda:UpdateFunctionConfiguration","lambda:DeleteFunction","lambda:GetFunctionConfiguration","lambda:ListVersionsByFunction","lambda:TagResource","lambda:ListTags"], "Resource": "arn:aws:lambda:us-east-1:$ACCOUNT_ID:function:TicketApiFunction" },
    { "Sid": "FunctionUrlScoped", "Effect": "Allow", "Action": ["lambda:CreateFunctionUrlConfig","lambda:GetFunctionUrlConfig","lambda:UpdateFunctionUrlConfig","lambda:DeleteFunctionUrlConfig","lambda:AddPermission","lambda:RemovePermission"], "Resource": "arn:aws:lambda:us-east-1:$ACCOUNT_ID:function:TicketApiFunction" },
    { "Sid": "TableScoped", "Effect": "Allow", "Action": ["dynamodb:CreateTable","dynamodb:DescribeTable","dynamodb:DeleteTable","dynamodb:UpdateTable","dynamodb:TagResource","dynamodb:ListTagsOfResource"], "Resource": "arn:aws:dynamodb:us-east-1:$ACCOUNT_ID:table/subdesk-api-dev-*" },
    { "Sid": "LogsScoped", "Effect": "Allow", "Action": ["logs:DescribeLogGroups","logs:ListTagsForResource","logs:CreateLogGroup","logs:PutRetentionPolicy","logs:TagResource","logs:DeleteLogGroup"], "Resource": "arn:aws:logs:us-east-1:$ACCOUNT_ID:log-group:/aws/lambda/TicketApiFunction*" },
    { "Sid": "CFNRolesLifecycle", "Effect": "Allow", "Action": ["iam:CreateRole","iam:GetRole","iam:GetRolePolicy","iam:PutRolePolicy","iam:DeleteRolePolicy","iam:DeleteRole","iam:TagRole","iam:UntagRole","iam:ListRolePolicies","iam:ListAttachedRolePolicies","iam:ListInstanceProfilesForRole","iam:UpdateAssumeRolePolicy"], "Resource": "arn:aws:iam::$ACCOUNT_ID:role/subdesk-api-dev-*" },
    { "Sid": "PassRoleToStackRolesOnly", "Effect": "Allow", "Action": "iam:PassRole", "Resource": "arn:aws:iam::$ACCOUNT_ID:role/subdesk-api-dev-*", "Condition": { "StringEquals": { "iam:PassedToService": "lambda.amazonaws.com" } } },
    { "Sid": "WhoAmI", "Effect": "Allow", "Action": "sts:GetCallerIdentity", "Resource": "*" }
  ]
}
JSON
)"
aws iam put-role-policy --role-name "$ROLE_NAME" --policy-name "$POLICY_NAME" --policy-document "$POLICY"

# ---- 4) Resultado: el AWS_ROLE_ARN que va al environment dev de GitHub ----
ARN="$(aws iam get-role --role-name "$ROLE_NAME" --query Role.Arn --output text)"
echo
echo "=== HECHO. Pega este ARN como secreto AWS_ROLE_ARN en el environment '$GITHUB_ENVIRONMENT' ==="
echo "$ARN"
