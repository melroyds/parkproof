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

Apple's identifier model has three pieces that all need to exist before the federation works:

```
App ID (the app's identity)              — created in Identifiers section
  ↓
Services ID (the OAuth client)            — created in Identifiers section, links to the App ID above
  ↓
Key (signs the OAuth tokens)              — created in the Keys section (separate top-level area)
```

The Apple Developer portal has FIVE top-level sections in its left sidebar: Certificates, **Identifiers**, Devices, Profiles, **Keys**. Keys is its own section, NOT a sub-page under Identifiers — that's where the `.p8` private key gets generated.

### Step 1 — App ID (in Identifiers section)

1. Sign in at <https://developer.apple.com/account/resources/identifiers/list>
2. Top-right of the Identifiers list page, set the filter dropdown to **"App IDs"** (defaults to "Services IDs" which look almost identical and is the most common point of confusion).
3. Click **+** → **App IDs** → **Continue** → **App** → **Continue**.
4. Fill in:
   - **Description**: `ParkProof`
   - **Bundle ID** (Explicit, not Wildcard): `au.com.parkproof.app` (reverse-DNS using a domain you control)
5. Scroll down to **Capabilities** and tick **Sign In with Apple**.
6. **Continue** → **Register**.

The Bundle ID can't be changed later — pick something durable. It's free to create as many App IDs as you want; no charge per identifier.

### Step 2 — Services ID (in Identifiers section)

1. Same Identifiers page, switch the filter back to **"Services IDs"**.
2. Click **+** → **Services IDs** → **Continue**.
3. Fill in:
   - **Description**: `ParkProof Web Sign-in`
   - **Identifier**: `au.com.parkproof.signin` (reverse-DNS; conventionally App-ID-suffixed with `.signin` but anything unique works)
4. **Continue** → **Register**.
5. Click into the new Services ID from the list. Tick **Sign In with Apple** → click **Configure** on the same row → in the modal:
   - **Primary App ID**: select the App ID created in step 1 (`au.com.parkproof.app`).
   - **Domains and Subdomains**: `<your-hosted-ui-domain>` (e.g. `parkproof-<account-id>.auth.ap-southeast-2.amazoncognito.com`) — no `https://` prefix.
   - **Return URLs**: `https://<your-hosted-ui-domain>/oauth2/idpresponse`
   - **Save** → **Continue** → **Save**.

### Step 3 — Key (in the Keys section — separate top-level area)

1. Go to <https://developer.apple.com/account/resources/authkeys/list> (or click **Keys** in the left sidebar of the developer portal).
2. Click **+** to create a new key.
3. **Key Name**: `ParkProof Sign In with Apple` (or any descriptive name — appears only in your Keys list, doesn't get sent anywhere).
4. Tick **Sign in with Apple** in the capabilities list. A blue **Configure** button appears alongside it.
5. Click **Configure** → in the modal, set **Primary App ID** to the App ID from step 1 → **Save**.
6. **Continue** → **Register**.

> **CRITICAL — download the `.p8` file NOW.** The page after Register has a one-time download button. Apple shows the file *exactly once*. If you navigate away without downloading, you have to revoke the key and create a fresh one. Save the `.p8` somewhere you'll find it again (`Documents/parkproof-apple-key.p8` is fine).

7. Also note from this page:
   - **Key ID** — a 10-character string like `ABC123DEF4`. Permanent; you can come back to view it any time on the key's detail page.
   - **Team ID** — visible at the top-right of every page in the developer portal, next to your name. Also 10 characters.

### Step 4 — Flatten the `.p8` for AWS CLI

The `.p8` is multi-line PEM:

```
-----BEGIN PRIVATE KEY-----
MIGTAgEAMBMGByqGSM49AgEG...
...
-----END PRIVATE KEY-----
```

AWS CLI's `--provider-details` argument needs it as a single line with literal `\n` between rows. From the directory containing the `.p8` file:

```bash
awk 'NF {sub(/\r/, ""); printf "%s\\n",$0;}' AuthKey_XXXXX.p8
```

(Replace `XXXXX` with the actual key ID — Apple names the file after it.) Copy the output line; that's the value for `private_key` below.

### Step 5 — Tell Cognito about Apple

Register Apple as an identity provider on your User Pool:

```bash
aws cognito-idp create-identity-provider \
  --user-pool-id <COGNITO_USER_POOL_ID> \
  --provider-name SignInWithApple \
  --provider-type SignInWithApple \
  --provider-details "client_id=<SERVICES_ID>,team_id=<TEAM_ID>,key_id=<KEY_ID>,private_key=<P8_AS_SINGLE_LINE>,authorize_scopes=email name" \
  --attribute-mapping email=email,username=sub \
  --region ap-southeast-2
```

Substitute:
- `<SERVICES_ID>` — the Services ID identifier from step 2 (e.g. `au.com.parkproof.signin`)
- `<TEAM_ID>` — the 10-char team ID from the developer-portal top-right
- `<KEY_ID>` — the 10-char key ID shown after step 3 registration
- `<P8_AS_SINGLE_LINE>` — the output of the `awk` command from step 4

### Step 6 — Enable Apple as a supported provider on the App Client

```bash
aws cognito-idp update-user-pool-client \
  --user-pool-id <COGNITO_USER_POOL_ID> \
  --client-id <COGNITO_APP_CLIENT_ID> \
  --supported-identity-providers COGNITO Google SignInWithApple \
  --region ap-southeast-2
```

(If you haven't enabled Google yet, drop it from the list — only ever pass providers that have a matching `create-identity-provider` already done.)

### Test

Open the live app, click "Continue with Apple", you should land on Apple's
sign-in page → consent → back to ParkProof signed in.

## Rotating the Apple Bundle ID / Services ID later

If you need to swap the Bundle ID + Services ID after the fact (e.g., to
remove a personal name from the OAuth consent screen), the safe path is:

1. Register a NEW App ID, Services ID, and Key in Apple Developer Console
   (Steps 1-3 above). Keep the old ones alive in parallel — don't revoke yet.
2. Use `update-identity-provider` (NOT `create-identity-provider`) to swap
   Cognito's `SignInWithApple` provider over to the new Services ID + Key.
   This keeps the same provider name, so the App Client's
   `--supported-identity-providers` list stays correct with zero downtime.
3. Smoke-test in an incognito window with "Continue with Apple".
4. Once green, retire the old Key (Revoke) + old Services ID + old App ID
   from Apple Developer Console.

**Gotcha — `--provider-details` shell escaping is hostile to multi-line
keys.** Passing the flattened `\n`-separated key via the inline shorthand
syntax (`--provider-details "client_id=...,private_key=$P8,..."`) fails
with `InvalidParameterException: Provided private key cannot be used for
Sign in with Apple`. AWS CLI doesn't translate the literal `\n` chars,
and Cognito doesn't either — Apple receives a malformed PEM and rejects.
The reliable path is a JSON file with proper `\n` escape sequences (JSON
parser converts them to real newlines):

```bash
# Write to a PROJECT-RELATIVE path (Windows aws.exe can't read /tmp/...)
cat > apple-idp.tmp.json <<EOF
{
  "client_id": "au.com.parkproof.signin",
  "team_id": "L89J489GL4",
  "key_id": "<NEW_KEY_ID>",
  "private_key": "-----BEGIN PRIVATE KEY-----\nMIGT...\niCnQwOC8\n-----END PRIVATE KEY-----\n",
  "authorize_scopes": "email name"
}
EOF

aws cognito-idp update-identity-provider \
  --user-pool-id <COGNITO_USER_POOL_ID> \
  --provider-name SignInWithApple \
  --provider-details file://apple-idp.tmp.json \
  --region ap-southeast-2

rm apple-idp.tmp.json
```

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
