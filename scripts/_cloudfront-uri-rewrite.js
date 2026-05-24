// CloudFront viewer-request function — source of truth for the live function
// `parkproof-uri-rewrite` attached to distribution E33V8DMM3LQACG.
//
// IMPORTANT: This file is the canonical source. To deploy changes:
//   aws cloudfront describe-function --name parkproof-uri-rewrite --query ETag --output text
//   aws cloudfront update-function --name parkproof-uri-rewrite \
//     --function-code fileb://scripts/_cloudfront-uri-rewrite.js \
//     --function-config Comment="...",Runtime=cloudfront-js-2.0 \
//     --if-match <ETag-from-describe>
//   aws cloudfront publish-function --name parkproof-uri-rewrite --if-match <ETag-from-update>
//
// Global propagation: ~3 minutes after publish.
//
// Two responsibilities:
//   1. Resolve directory requests for the OAC-backed S3 REST origin (S3 REST
//      doesn't auto-append index.html like S3 website mode does).
//   2. Route the Cognito federated-auth callback path to the React PWA shell
//      so token exchange completes inside the SPA after the two-app cutover.
function handler(event) {
    var request = event.request;
    // Federated-auth OAuth callback. After the two-app cutover the React PWA
    // lives at /app/, but Cognito's whitelisted callback URL is /auth/callback
    // for legacy compat (changing it would invalidate every existing token).
    // Rewrite to the PWA shell so App.tsx mounts and consumes ?code= / ?state=.
    // Query string is preserved automatically.
    if (request.uri === '/auth/callback' || request.uri === '/auth/callback/') {
        request.uri = '/app/index.html';
        return request;
    }
    // OAC-backed S3 REST origin doesn't auto-resolve directory requests, so
    // append index.html for any trailing-slash URI: / → /index.html,
    // /app/ → /app/index.html, etc.
    if (request.uri.endsWith('/')) {
        request.uri += 'index.html';
    }
    return request;
}
