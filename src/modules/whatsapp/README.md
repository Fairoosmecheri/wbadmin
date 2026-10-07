# WhatsApp module

`WHATSAPP_MODE=mock` is the safe default. The mock provider persists delayed sent, delivered, read, and inbound events in `MockEvent`; `npm run worker` consumes them through the same webhook processor. Include `[mock:fail]` in a mock message body or template parameter to simulate delivery failure. The administrator/manager-only mock API can simulate incoming text, including `STOP` for opt-out testing. Mock events never create a live customer service window.

Live messaging uses the official Meta Graph API only. Configure `WHATSAPP_MODE=cloud`, `META_GRAPH_API_VERSION`, `WHATSAPP_ACCESS_TOKEN`, `WHATSAPP_PHONE_NUMBER_ID`, `WHATSAPP_BUSINESS_ACCOUNT_ID`, `WHATSAPP_WEBHOOK_VERIFY_TOKEN`, and `META_APP_SECRET` in the server environment. The Graph API version has no code default. Tokens stay on the server, and settings expose presence and masked values only. Graph requests use bearer headers and preserve TLS verification. Ambiguous transport/5xx sends are flagged for manual delivery review rather than retried automatically.

Subscribe the HTTPS `/api/webhooks/whatsapp` endpoint to WhatsApp messages. GET performs verify-token verification. POST bounds the body to 1 MiB, verifies HMAC-SHA256 over the raw body, and requires both the configured business account and phone-number ID. The processor persists individual events, serializes updates, applies message and campaign-recipient transitions atomically, and replays receipts that arrive before outbound persistence. Duplicate and out-of-order webhooks do not regress read/delivered status or inflate aggregate counters. Original event provenance follows messages during unmatched-contact review.

Free-form replies require an inbound message within the last 24 hours. In cloud mode that message must have signed webhook provenance from the currently configured business account/phone, match the customer's current primary phone, and be non-mock. Templates require recorded opt-in, `APPROVED` status, a numeric live Meta template ID, and a recent sync. `WHATSAPP_TEMPLATE_SYNC_MAX_AGE_HOURS` controls approval freshness (default 24, bounded to 1–168). Currently supported sends use text/static headers and numbered body variables; media headers, named variables, variable headers, and parameterized buttons are explicitly blocked. Status sync follows Meta, including unavailable/deleted templates.

Opt-out commands always include STOP, UNSUBSCRIBE, CANCEL, END, QUIT, OPT OUT and STOP ALL. `WHATSAPP_OPT_OUT_KEYWORDS` adds comma-separated exact commands in any language; matching normalizes Unicode, case, surrounding whitespace and trailing punctuation. Configuring additional words never removes the standard commands.

A contextual inbound reply is attributed to the campaign recipient with that message ID. Without explicit reply context, the most recent sent campaign within `WHATSAPP_REPLY_ATTRIBUTION_DAYS` is used (default 7, bounded to 1–30). Unmatched numbers are retained for review without automatically creating customers. Linking requires an existing customer with the exact primary phone and replays original inbound events; the worker continues any large replay backlog.

Text and image/document/audio/video attachment metadata are stored safely. Media downloading and sending attachments are not enabled in this version; provider media URLs and access tokens are never exposed to browsers. Browser interfaces render message text as escaped text rather than HTML.

Official references for deployment verification:
- https://developers.facebook.com/docs/whatsapp/cloud-api/
- https://developers.facebook.com/docs/whatsapp/cloud-api/webhooks/components
- https://developers.facebook.com/docs/graph-api/webhooks/getting-started
- https://developers.facebook.com/docs/whatsapp/business-management-api/message-templates/

The official documentation host returned a network-proxy 403 during implementation. A live Meta connection, supported API version, current policy and template approval must be verified with the business's own credentials before deployment. Mock and local PostgreSQL integration tests cover the implemented contracts; no live messages were sent.
