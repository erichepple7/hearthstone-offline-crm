# Private CRM AI service

This function is the secure reasoning layer for the CRM assistant. The browser sends a small, relevant CRM summary only after the owner is authenticated. The OpenAI key stays in Firebase and is never placed in the public website.

Activation checklist:

1. Install the Firebase CLI and sign in to the `hearthstone-real-estate-crm` project.
2. From the repository root, run `firebase functions:secrets:set OPENAI_API_KEY` and enter the key in the secure prompt.
3. Run `firebase deploy --only functions:crmAssistant`.
4. Copy the deployed HTTPS function URL into the CRM's `crm_ai_endpoint` browser setting.

The function only authorizes the Firebase user `erichepple7@gmail.com`. It does not save CRM changes and it does not log the CRM payload.

## Gmail connection

Gmail uses Google's free browser authorization. The public OAuth client ID may
be stored in `gmail-integration.js`; no client secret or Google password is
stored. Configure the Web client for `https://erichepple7.github.io`, enable the
Gmail API, and add `erichepple7@gmail.com` as the OAuth test user.

The connection requests only `gmail.send` and `gmail.readonly`. It does not
delete, archive, mark read, or modify labels. Google access tokens stay in
browser memory and expire after about one hour, so the CRM may ask the user to
reconnect. Conversation syncing runs every 10 minutes while the CRM is open.
