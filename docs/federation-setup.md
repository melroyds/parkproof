# Apple + Google sign-in setup

The hosted-UI infrastructure is already provisioned (`scripts/setup-auth.sh`
created the Cognito User Pool, App Client, and hosted-UI domain). The
"Continue with Apple / Google" buttons in the sign-in UI are wired and will
work the moment you register the OAuth clients with each provider and tell
Cognito about them.

This is a one-time job per provider, about 15 minutes each.

## Google (free)

1. Open <https://console.cloud.google.com/apis/credentials>.
2. Create (or pick) a project — call it whatever; ParkProof is fine.
3. Configure the OAuth consent screen:
   - **User Type**: External
   - **App name**: ParkProof
   - **User support email**: your email
   - **Authorised domain**: `amazoncognito.com`
4. Create OAuth 2.0 Client ID:
   - **Application type**: Web application
   - **Name**: ParkProof Web
   - **Authorised JavaScript origins**: `https://<your-hosted-ui-domain>` (find it in `scripts/.aws-resources` — the `COGNITO_HOSTED_UI_DOMAIN` value).
   - **Authorised redirect URIs**: `https://<your-hosted-ui-domain>/oauth2/idpresponse`
5. Copy the **Client ID** and **Client secret** Google generated.
6. Tell Cognito about it:

   ```bash
   aws cognito-idp create-identity-provider \
     --user-pool-id <COGNITO_USER_POOL_ID> \
     --provider-name Google \
     --provider-type Google \
     --provider-details "client_id=<GOOGLE_CLIENT_ID>,client_secret=<GOOGLE_CLIENT_SECRET>,authorize_scopes=openid email profile" \
     --attribute-mapping email=email,username=sub \
     --region ap-southeast-2
   ```

7. Update the Cognito App Client so it accepts Google as an IdP:

   ```bash
   aws cognito-idp update-user-pool-client \
     --user-pool-id <COGNITO_USER_POOL_ID> \
     --client-id <COGNITO_APP_CLIENT_ID> \
     --supported-identity-providers COGNITO Google \
     --region ap-southeast-2
   ```

Test: open the live app, click "Continue with Google", you should be
bounced into a Google consent screen and end up signed in to ParkProof.

## Apple ($99/year Apple Developer account required)

1. Sign in at <https://developer.apple.com/account/resources/identifiers/list>.
2. **Identifiers** → **+** → **Services IDs**.
   - **Description**: ParkProof Web Sign-in
   - **Identifier**: `tech.dsouza.parkproof.signin` (reverse-DNS; anything unique works)
3. Edit the new Services ID → enable **Sign In with Apple** → Configure:
   - **Primary App ID**: pick (or create) one — App IDs are siblings to Services IDs.
   - **Domains and Subdomains**: `<your-hosted-ui-domain>` (no `https://`).
   - **Return URLs**: `https://<your-hosted-ui-domain>/oauth2/idpresponse`
4. **Identifiers** → **+** → **Keys** → enable Sign In with Apple → Continue.
   - Download the `.p8` private key — Apple shows it once.
   - Note the **Key ID** and your **Team ID** (top-right corner of the developer portal).
5. The `.p8` content is the private key in PEM form. Convert it to a single-line
   string suitable for AWS CLI:

   ```bash
   awk 'NF {sub(/\r/, ""); printf "%s\\n",$0;}' AuthKey_XXXXX.p8
   ```

6. Tell Cognito about it:

   ```bash
   aws cognito-idp create-identity-provider \
     --user-pool-id <COGNITO_USER_POOL_ID> \
     --provider-name SignInWithApple \
     --provider-type SignInWithApple \
     --provider-details "client_id=<SERVICES_ID>,team_id=<TEAM_ID>,key_id=<KEY_ID>,private_key=<P8_AS_SINGLE_LINE>,authorize_scopes=email name" \
     --attribute-mapping email=email,username=sub \
     --region ap-southeast-2
   ```

7. Update the Cognito App Client supported-identity-providers list to include Apple:

   ```bash
   aws cognito-idp update-user-pool-client \
     --user-pool-id <COGNITO_USER_POOL_ID> \
     --client-id <COGNITO_APP_CLIENT_ID> \
     --supported-identity-providers COGNITO Google SignInWithApple \
     --region ap-southeast-2
   ```

Test: open the live app, click "Continue with Apple", you should land on
Apple's sign-in page → consent → back to ParkProof signed in.

## When it goes wrong

- **"Error: redirect_mismatch"** from Cognito: the callback URL the frontend
  sends doesn't match what's registered on the App Client. Re-run
  `scripts/setup-auth.sh` to refresh the App Client's allow-list.
- **"Invalid identity_provider"** from Cognito: you haven't run the
  `update-user-pool-client --supported-identity-providers` step above, OR
  the provider name in the URL doesn't match Cognito's name exactly
  (`Google`, `SignInWithApple` — case-sensitive).
- **Apple silently fails after consent**: the `.p8` private key wasn't
  pasted correctly. The newline escaping is fiddly — use the `awk` command
  above to produce a clean single-line value.
- **User signs in but gets the wrong email**: Apple's "Hide my email"
  feature returns a relay address. This is intentional — store it as-is;
  it forwards correctly to the user's real inbox.
