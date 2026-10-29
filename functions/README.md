# Private CRM AI service

This function is the secure reasoning layer for the CRM assistant. The browser sends a small, relevant CRM summary only after the owner is authenticated. The OpenAI key stays in Firebase and is never placed in the public website.

Activation checklist:

1. Install the Firebase CLI and sign in to the `hearthstone-real-estate-crm` project.
2. From the repository root, run `firebase functions:secrets:set OPENAI_API_KEY` and enter the key in the secure prompt.
3. Run `firebase deploy --only functions:crmAssistant`.
4. Copy the deployed HTTPS function URL into the CRM's `crm_ai_endpoint` browser setting.

The function only authorizes the Firebase user `erichepple7@gmail.com`. It does not save CRM changes and it does not log the CRM payload.

## Gmail connection

The CRM also includes a private Gmail integration for `erichepple7@gmail.com`.
It sends reviewed email, imports matching Gmail conversations into Contacts, and
keeps OAuth refresh tokens in an owner-only server document. Tokens are never
returned to the browser or included in the public GitHub Pages files.

One-time Google Cloud setup:

1. Enable the Gmail API in the `hearthstone-real-estate-crm` Google Cloud project.
2. Configure the OAuth consent screen for a personal-use external app and add
   `erichepple7@gmail.com` as the authorized/test user.
3. Create a Web application OAuth client.
4. Add this authorized redirect URI exactly:
   `https://us-central1-hearthstone-real-estate-crm.cloudfunctions.net/gmailOAuthCallback`
5. Save the credentials with:
   `firebase functions:secrets:set GMAIL_CLIENT_ID`
   and `firebase functions:secrets:set GMAIL_CLIENT_SECRET`.
6. Deploy `gmailConnect,gmailOAuthCallback,gmailStatus,gmailDisconnect,gmailSync,gmailSend`.
7. Open Inbox & Drafts in the CRM and select **Connect erichepple7@gmail.com**.

Scopes are deliberately limited to `gmail.send` and `gmail.readonly`. The CRM
does not delete, archive, mark read, or modify Gmail labels.
