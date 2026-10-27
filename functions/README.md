# Private CRM AI service

This function is the secure reasoning layer for the CRM assistant. The browser sends a small, relevant CRM summary only after the owner is authenticated. The OpenAI key stays in Firebase and is never placed in the public website.

Activation checklist:

1. Install the Firebase CLI and sign in to the `hearthstone-real-estate-crm` project.
2. From the repository root, run `firebase functions:secrets:set OPENAI_API_KEY` and enter the key in the secure prompt.
3. Run `firebase deploy --only functions:crmAssistant`.
4. Copy the deployed HTTPS function URL into the CRM's `crm_ai_endpoint` browser setting.

The function only authorizes the Firebase user `erichepple7@gmail.com`. It does not save CRM changes and it does not log the CRM payload.
