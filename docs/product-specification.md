# MASTER BUILD PROMPT — PRIVATE WHATSAPP-FIRST CRM

You are acting as the senior product architect and full-stack engineer for this project.

Build a production-quality private CRM focused on customer management, WhatsApp marketing campaigns, WhatsApp conversations, segmentation, and sales follow-ups.

This is NOT intended to become an ERP, accounting system, inventory system, or billing application.

The application will initially manage approximately 1,000 customers, but the architecture should comfortably support 50,000+ customers later without requiring a rewrite.

Do not only scaffold the project. Build the actual working application module by module.

---

# 1. PRODUCT GOAL

Build a simple, fast, professional CRM where a business can:

1. Maintain its customer database.
2. Import customers from Excel/CSV.
3. Categorize customers by area, route, customer type, tags, etc.
4. Search and filter customers.
5. Create reusable dynamic customer segments.
6. Record notes and activities against customers.
7. Assign customers to salespeople.
8. Schedule customer follow-ups.
9. Connect the official Meta WhatsApp Business Platform / Cloud API.
10. Maintain approved WhatsApp templates.
11. Send targeted WhatsApp campaigns.
12. Track campaign delivery, reads, failures and replies.
13. Receive customer WhatsApp messages.
14. Reply to customers through an inbox.
15. View the complete customer communication timeline.
16. Identify customers requiring follow-up.
17. Measure campaign response and conversion.
18. Handle WhatsApp opt-in and opt-out properly.

The product should feel like a purpose-built CRM rather than an admin CRUD panel.

---

# 2. IMPORTANT SCOPE LIMIT

DO NOT add:

- Accounting
- GST accounting
- Invoicing
- Purchase management
- Inventory
- Warehouse management
- Payroll
- HR
- Full ERP functionality
- Payment gateway
- E-commerce
- Supplier management

Do not expand the scope unless explicitly instructed later.

V1 is:

CUSTOMERS
+
SEGMENTATION
+
FOLLOW-UPS
+
WHATSAPP
+
CAMPAIGNS
+
INBOX
+
REPORTING

---

# 3. TECHNOLOGY STACK

Use:

Frontend:
- Latest stable Next.js
- App Router
- TypeScript
- Tailwind CSS
- shadcn/ui where appropriate
- Lucide icons

Backend:
- Next.js server-side APIs / route handlers
- TypeScript

Database:
- PostgreSQL

Database layer:
- Use a mature TypeScript ORM that supports PostgreSQL and proper migrations.
- Prisma is acceptable.
- If a clearly better maintained option exists at implementation time, document the choice before using it.

Validation:
- Zod

Forms:
- React Hook Form where appropriate

Tables:
- TanStack Table where useful

Phone parsing:
- libphonenumber-js or equivalent

Authentication:
- Secure email/password login
- Use a maintained authentication package such as Auth.js or an equivalent current stable solution.
- Passwords must never be stored in plaintext.
- Use bcrypt/argon2 or an appropriate secure password hashing mechanism.

Do not hardcode secrets.

All credentials must come from environment variables.

---

# 4. APPLICATION ARCHITECTURE

Use a clean modular architecture.

Suggested modules:

src/
  app/
  components/
  modules/
    auth/
    users/
    customers/
    tags/
    segments/
    followups/
    whatsapp/
    templates/
    campaigns/
    conversations/
    reports/
    settings/
  lib/
  repositories/
  services/
  validations/
  types/

Separate:

UI
Repository/database access
Business logic/services
External integrations
Validation

Avoid putting large amounts of business logic directly inside React components or route handlers.

---

# 5. USER ROLES

Support these roles:

ADMIN
MANAGER
SALESMAN

ADMIN:
- Complete system access
- Manage users
- Manage WhatsApp integration
- Create campaigns
- Send campaigns
- Manage templates
- Import/export customers
- Access reports
- Delete/archive records
- Manage settings

MANAGER:
- Customer management
- Segments
- Campaigns
- Inbox
- Follow-ups
- Reports
- Salesman assignment

SALESMAN:
- View assigned customers
- View customer conversations
- Add notes
- Create/update follow-ups
- Reply to permitted conversations
- Update customer/contact outcome

Campaign sending and WhatsApp configuration should be restricted to appropriate roles.

Implement authorization on the server, not merely by hiding UI elements.

---

# 6. DATABASE DESIGN

Design proper PostgreSQL relationships, indexes, constraints and timestamps.

Every major table should have:

id
createdAt
updatedAt

Use UUID/CUID or another appropriate non-sequential public identifier.

## USER

Fields:

id
name
email
passwordHash
role
phone nullable
active
lastLoginAt nullable
createdAt
updatedAt

---

# 7. CUSTOMER MASTER

Customer is the central entity.

Customer fields:

id

customerCode
businessName
contactPerson
phone
phoneNormalized
alternatePhone nullable
email nullable

customerTypeId nullable
areaId nullable
routeId nullable
assignedUserId nullable

status

whatsappOptIn
whatsappOptInAt nullable
whatsappOptInSource nullable
whatsappOptOutAt nullable
whatsappOptOutReason nullable

addressLine1 nullable
addressLine2 nullable
city nullable
district nullable
state nullable
postalCode nullable
country nullable

notes nullable

lastContactedAt nullable
lastCustomerMessageAt nullable
lastBusinessMessageAt nullable
lastCampaignAt nullable
lastOrderDate nullable

createdAt
updatedAt
archivedAt nullable

Customer statuses:

ACTIVE
INACTIVE
PROSPECT
DO_NOT_CONTACT
ARCHIVED

Phone numbers should be normalized to E.164.

Do not allow accidental duplicate customers with the same normalized primary phone number.

Make duplicate detection intelligent during imports.

Default phone country should be configurable using:

DEFAULT_PHONE_COUNTRY=IN

Do not permanently hardcode India into business logic.

---

# 8. CUSTOMER TYPES

Separate configurable table:

CustomerType

Examples in seed data:

- HoReCa
- Distributor
- Retailer
- Supermarket
- Bakery
- Bakery Production Unit
- Home Baker
- Other

Admin must be able to create/edit/archive customer types.

---

# 9. AREAS

Area table:

id
name
active

Example:

Manjeri
Malappuram
Calicut
Kochi

These are example seed data only.

---

# 10. ROUTES

Route table:

id
name
description nullable
assignedUserId nullable
active

Customers can optionally belong to a route.

---

# 11. CUSTOMER TAGS

Tag:

id
name
description nullable

CustomerTag:

customerId
tagId

Allow unlimited tags.

Examples:

VIP
High Potential
Mayonnaise Buyer
Inactive
New Customer
Needs Follow-up

Display tags clearly in customer lists and customer detail pages.

---

# 12. CUSTOMER LIST

Create a powerful customer table.

Columns should include:

Customer Code
Business Name
Contact
Phone
Customer Type
Area
Route
Salesman
Tags
WhatsApp Status
Last Contact
Status
Actions

Features:

- Search
- Pagination
- Sort
- Multi-column filters
- Column visibility
- Bulk select
- Bulk tagging
- Bulk assign salesman
- Bulk status update
- Export selected
- Archive
- Open customer

Search should work on:

- business name
- contact person
- phone
- customer code
- email

Provide useful filters:

Customer type
Area
Route
Salesman
Tag
Status
WhatsApp opt-in
Last contacted
Last order
Created date

Filters should be combinable.

---

# 13. CUSTOMER DETAIL PAGE

Customer detail page should be one of the strongest parts of the application.

Header:

Business name
Contact person
Phone
WhatsApp status
Customer type
Area
Route
Assigned salesman
Tags
Status

Quick actions:

WhatsApp
Add Note
Add Follow-up
Edit Customer
Change Assignment

Use tabs or sections:

OVERVIEW
CONVERSATION
ACTIVITY
FOLLOW-UPS
CAMPAIGNS
NOTES

The customer timeline should show chronologically:

Customer created
Customer edited
Tags changed
Salesman changed
Notes added
Follow-up created
Follow-up completed
Campaign sent
WhatsApp delivered
WhatsApp read
Customer WhatsApp message
Business reply
Opt-in changed
Opt-out

Timeline should be readable and not expose raw database events to the user.

---

# 14. NOTES

CustomerNote:

id
customerId
content
createdByUserId
createdAt
updatedAt

Notes should appear on the customer timeline.

Allow editing based on permission.

Avoid silently deleting notes.

---

# 15. ACTIVITY LOG

Maintain ActivityLog.

Fields:

id
customerId nullable
userId nullable
type
entityType nullable
entityId nullable
description
metadata JSONB nullable
createdAt

Use it for meaningful CRM events.

Do not log irrelevant low-level technical operations.

---

# 16. CUSTOMER IMPORT

This is a high-priority feature.

Support:

CSV
XLSX

Create an import wizard.

STEP 1:
Upload file.

STEP 2:
Preview first rows.

STEP 3:
Map spreadsheet columns.

Possible fields:

Customer Code
Business Name
Contact Person
Phone
Alternate Phone
Email
Area
Route
Customer Type
Salesman
Tags
Address
City
District
State
PIN Code
WhatsApp Opt-in

STEP 4:
Validate data.

Show:

Valid rows
Invalid rows
Duplicates
Warnings

STEP 5:
Choose duplicate behavior:

Skip existing
Update existing
Review individually

STEP 6:
Import.

STEP 7:
Show import report.

Never silently overwrite existing customers.

Phone normalization should happen before duplicate checking.

For duplicate detection prioritize normalized phone number.

Store import batch history.

ImportBatch:

id
fileName
uploadedBy
totalRows
validRows
invalidRows
insertedRows
updatedRows
skippedRows
status
createdAt
completedAt

Allow downloading rows that failed validation.

Also provide an example Excel import template.

---

# 17. EXPORT

Allow exporting filtered customer lists to XLSX/CSV.

Export should respect current filters.

Exportable fields should include customer master information and tags.

---

# 18. SEGMENTS

Build dynamic customer segments.

Segment examples:

"Manjeri HoReCa"

Conditions:

Customer Type = HoReCa
AND
Area = Manjeri
AND
WhatsApp Opt-in = Yes

Another:

"Inactive 45 Days"

Last Contacted > 45 days
AND
Status = Active

Segment fields:

id
name
description nullable
filterDefinition JSONB
createdBy
createdAt
updatedAt

Allow:

Preview Segment
Customer Count
Save Segment
Edit Segment
Duplicate Segment

Segments should be dynamic.

Do not copy customers into a segment permanently.

When a campaign is created from a segment, snapshot the recipients into CampaignRecipient.

---

# 19. FOLLOW-UP MODULE

FollowUp:

id
customerId
assignedUserId
createdByUserId

type
priority
status

dueAt

title
notes nullable
outcome nullable

completedAt nullable
createdAt
updatedAt

Types:

CALL
WHATSAPP
VISIT
GENERAL

Priorities:

LOW
NORMAL
HIGH
URGENT

Statuses:

PENDING
COMPLETED
CANCELLED

Outcomes:

INTERESTED
NOT_INTERESTED
CALL_LATER
ORDER_CONFIRMED
NO_RESPONSE
OTHER

Dashboard sections:

Overdue
Today
Tomorrow
This Week
Upcoming

Salespeople should easily see:

"My Follow-ups"

Allow creating a follow-up directly from:

Customer page
Conversation
Campaign response

---

# 20. WHATSAPP INTEGRATION

Use ONLY the official Meta WhatsApp Business Platform / Cloud API.

DO NOT:

- automate WhatsApp Web
- scrape WhatsApp
- use browser automation
- use Selenium
- use unofficial libraries pretending to be WhatsApp clients
- bypass WhatsApp rate limits
- bypass template rules
- bypass opt-in requirements

Integration should follow the latest official Meta WhatsApp documentation available when implementing it.

Do not hardcode a Graph API version throughout the source.

Use configuration such as:

META_GRAPH_API_VERSION

Environment variables should include appropriate values such as:

META_GRAPH_API_VERSION
WHATSAPP_ACCESS_TOKEN
WHATSAPP_PHONE_NUMBER_ID
WHATSAPP_BUSINESS_ACCOUNT_ID
WHATSAPP_WEBHOOK_VERIFY_TOKEN
META_APP_SECRET

Actual names can be adjusted if needed but document them clearly.

---

# 21. WHATSAPP SETTINGS

Create:

Settings > WhatsApp

Display connection state.

Fields/status:

Business Account ID
Phone Number ID
Connected Phone Number
Business Display Name if available
Connection Status
Webhook Status
Last Successful Webhook
API Version

Secrets must be masked after saving.

Add:

Test Connection

Do not expose access tokens to the browser.

---

# 22. WHATSAPP WEBHOOK

Implement official webhook verification.

Create appropriate GET verification endpoint and POST webhook receiver.

Verify webhook authenticity according to current Meta documentation.

Where applicable verify signatures using the Meta app secret.

Webhook processing must be:

idempotent
safe
logged
resilient

Store webhook events sufficiently for debugging.

WebhookEvent:

id
externalEventId nullable
eventType
payload JSONB
processed
processedAt nullable
error nullable
createdAt

Never display unnecessary raw customer data in normal application screens.

---

# 23. WHATSAPP MESSAGE TABLE

Message:

id
conversationId
customerId

direction:
INBOUND
OUTBOUND

type:
TEXT
IMAGE
DOCUMENT
AUDIO
VIDEO
LOCATION
CONTACT
TEMPLATE
INTERACTIVE
SYSTEM
UNKNOWN

whatsappMessageId nullable

textContent nullable
mediaId nullable
mediaUrl nullable
mimeType nullable

templateName nullable

status:
QUEUED
SENT
DELIVERED
READ
FAILED
RECEIVED

errorCode nullable
errorMessage nullable

sentAt nullable
deliveredAt nullable
readAt nullable
failedAt nullable

rawPayload JSONB nullable

createdAt
updatedAt

Add unique constraints for WhatsApp message IDs where appropriate so duplicate webhooks do not duplicate messages.

---

# 24. CONVERSATIONS

Conversation:

id
customerId
status
assignedUserId nullable
lastMessageAt
unreadCount
createdAt
updatedAt

Statuses:

OPEN
CLOSED

One customer should normally have one active WhatsApp conversation stream.

---

# 25. WHATSAPP INBOX

Build a WhatsApp-style inbox.

Layout:

LEFT:
Conversation list

CENTER:
Conversation thread

RIGHT:
Customer information

Conversation list should display:

Customer
Last message
Time
Unread indicator
Assigned salesman
Tags

Filters:

All
Unread
Mine
Unassigned
Open
Closed

Conversation thread:

Inbound messages on left
Outbound messages on right

Show:

Sent
Delivered
Read
Failed

Right customer panel:

Business name
Contact person
Phone
Type
Area
Route
Tags
Assigned salesman
Next follow-up
Quick note

Quick actions:

Add Follow-up
Add Note
Assign User
View Full Customer

---

# 26. 24-HOUR CUSTOMER SERVICE WINDOW

Implement WhatsApp messaging rules correctly.

Track:

lastCustomerMessageAt

Determine whether a free-form customer-service reply is currently permitted based on current WhatsApp rules.

Display clearly in the conversation composer.

Example states:

CUSTOMER SERVICE WINDOW OPEN

or

TEMPLATE REQUIRED

Do not permit the UI to send an invalid free-form message when a template is required.

Do not hardcode WhatsApp business rules permanently if Meta exposes a safer/current mechanism.

Keep the integration implementation easy to update when policies change.

---

# 27. MESSAGE TEMPLATES

Create WhatsApp Template module.

Prefer syncing template status from Meta rather than inventing approval state locally.

Template information:

id
metaTemplateId nullable
name
language
category
status
headerType nullable
headerContent nullable
body
footer nullable
buttons JSONB nullable
variables JSONB nullable
lastSyncedAt
createdAt
updatedAt

Statuses may include values returned by Meta.

Provide:

Sync Templates
View Template
Preview Template
Search
Filter by language
Filter by category
Filter by status

Campaigns should only use templates currently allowed by WhatsApp.

---

# 28. TEMPLATE PREVIEW

Render a WhatsApp-style preview.

Support variables such as:

{{1}}
{{2}}

Map variables to CRM fields where appropriate.

Example:

Hello {{1}},

We have a special offer available this week.

Variable 1:
Customer Contact Person

Before sending a campaign, preview the final message using a sample customer.

---

# 29. CAMPAIGN MODULE

Campaign:

id
name
description nullable

templateId

segmentId nullable

status

scheduledAt nullable
startedAt nullable
completedAt nullable

createdByUserId

totalRecipients
queuedCount
sentCount
deliveredCount
readCount
failedCount
repliedCount
interestedCount
orderCount

createdAt
updatedAt

Statuses:

DRAFT
SCHEDULED
QUEUED
SENDING
PAUSED
COMPLETED
CANCELLED
FAILED

---

# 30. CAMPAIGN CREATION FLOW

Use a wizard.

STEP 1:
Campaign Details

Campaign name
Description

STEP 2:
Audience

Choose:

Saved Segment

or

Build Filter

Show:

Matching customers
WhatsApp eligible customers
Opted-out customers
Invalid phone numbers

Only eligible opted-in recipients should proceed.

STEP 3:
Select Template

Only permitted templates.

STEP 4:
Map Variables

Example:

{{1}} = Contact Person
{{2}} = Business Name

STEP 5:
Preview

Preview actual rendered messages for several customers.

STEP 6:
Test Send

Allow sending a test message to an authorized test number.

STEP 7:
Review

Display clearly:

Total matched
Eligible
Excluded
Opted out
Invalid phone
Duplicates removed

STEP 8:
Send now or Schedule.

Before a large send, require an explicit confirmation action.

Do not make accidental mass messaging easy.

---

# 31. CAMPAIGN RECIPIENT SNAPSHOT

CampaignRecipient:

id
campaignId
customerId
phone

renderedPayload JSONB

status

whatsappMessageId nullable

queuedAt nullable
sentAt nullable
deliveredAt nullable
readAt nullable
failedAt nullable
repliedAt nullable

failureReason nullable

responseClassification nullable

createdAt
updatedAt

Unique constraint:

campaignId + customerId

A customer must not accidentally receive the same campaign twice.

Possible response classifications:

INTERESTED
NOT_INTERESTED
NEEDS_FOLLOWUP
ORDER_CONFIRMED
NO_RESPONSE
OTHER

---

# 32. CAMPAIGN SENDING ENGINE

Do NOT send 1,000 HTTP requests directly from the UI request.

Build a proper queue/worker mechanism.

Keep infrastructure simple.

Because PostgreSQL is already available, a PostgreSQL-backed job/recipient queue is preferred unless there is a strong technical reason for additional infrastructure.

A separate worker process may claim pending recipients safely using database locking such as:

FOR UPDATE SKIP LOCKED

or an equivalent safe ORM approach.

Worker responsibilities:

Fetch queued recipients
Respect configured rate limits
Render final template payload
Send through Meta API
Store WhatsApp message ID
Record send state
Retry transient failures
Do not retry permanent validation failures
Prevent duplicates
Continue processing if one recipient fails

Configuration:

WHATSAPP_SEND_BATCH_SIZE
WHATSAPP_SEND_RATE_LIMIT

Do not attempt to defeat Meta's rate limits.

The application should tolerate restarts without duplicate sends.

Provide:

npm run worker

for local/deployment worker execution if using this architecture.

Document how the worker should run in production.

---

# 33. CAMPAIGN CONTROL

Allow:

Pause
Resume
Cancel future unsent recipients

Already-sent messages obviously cannot be recalled by the CRM.

Show progress while a campaign is sending.

Example:

286 recipients

251 sent
238 delivered
194 read
12 replied
4 failed

---

# 34. CAMPAIGN REPORT

Campaign report page:

Campaign name
Template
Audience
Created by
Sent date

Metrics cards:

Recipients
Sent
Delivered
Read
Failed
Replies
Interested
Orders

Rates:

Delivery Rate
Read Rate
Reply Rate
Interest Rate
Conversion Rate

Recipient table:

Customer
Phone
Sent
Delivered
Read
Reply
Classification
Failure

Allow filters.

Allow exporting campaign results.

---

# 35. CUSTOMER RESPONSES

When a customer replies after a campaign:

Link the reply to:

Customer
Conversation
Most likely campaign where appropriate

Update:

Campaign repliedCount

Set recipient:

repliedAt

Do not automatically classify intent using unreliable assumptions.

Initially allow manual classification:

Interested
Not Interested
Follow-up
Order Confirmed
Other

We can add AI classification later.

---

# 36. OPT-IN MANAGEMENT

WhatsApp marketing consent is important.

Track:

whatsappOptIn
whatsappOptInAt
whatsappOptInSource

Possible sources:

IN_PERSON
FORM
WEBSITE
WHATSAPP
IMPORT
MANUAL
OTHER

If imported:

Do not automatically claim consent was obtained unless the source data explicitly indicates it.

Allow admin to update consent with a note.

Customers without marketing consent should not be included in promotional campaign sending.

Transactional/service messaging may have different rules, but always follow current Meta policy.

---

# 37. OPT-OUT

Allow:

Manual Opt-out

Store:

whatsappOptOutAt
whatsappOptOutReason

Provide configurable opt-out keywords such as:

STOP
UNSUBSCRIBE

Do not rely entirely on keywords.

If a customer is DO_NOT_CONTACT or WhatsApp opted-out:

Block promotional campaigns.

Show a strong warning in the UI.

---

# 38. DASHBOARD

Main dashboard should be useful, not decorative.

Cards:

Total Customers
Active Customers
WhatsApp Opted-In
Follow-ups Today
Overdue Follow-ups
Unread WhatsApp
Campaigns This Month

Charts:

Campaign delivery/read/reply trend

Customer distribution by type

Customer distribution by area

Follow-up completion

Recent campaigns

Recent conversations

Today's follow-ups

Avoid excessive charts.

---

# 39. REPORTS

Create practical reports:

Customer Overview

Customers by Type
Customers by Area
Customers by Route
Customers by Salesman

Engagement

Never Contacted
Not Contacted in 30 days
Not Contacted in 60 days
Not Contacted in 90 days

WhatsApp

Opted-In
Opted-Out
Invalid Numbers

Campaigns

Sent
Delivery
Read
Replies
Conversions

Follow-ups

Pending
Overdue
Completed
By salesman

Allow appropriate date filters.

---

# 40. GLOBAL SEARCH

Add global search in the navigation.

Search:

Customer business name
Contact person
Customer code
Phone

Selecting a result opens the customer.

Keep it fast.

Use database indexes appropriately.

---

# 41. UI / UX

The application should look polished and professional.

Style:

Clean
Minimal
Modern
Business-oriented
Fast
Spacious but not wasteful

Use a left sidebar on desktop.

Suggested navigation:

Dashboard

CUSTOMERS
Customers
Segments
Imports

SALES
Follow-ups

WHATSAPP
Inbox
Campaigns
Templates

REPORTS
Reports

ADMIN
Users
Settings

Responsive mobile/tablet behavior should be good, particularly:

Inbox
Customer detail
Follow-ups

Desktop remains the primary interface.

Use:

Loading skeletons
Empty states
Error states
Confirmation dialogs
Toast notifications
Accessible forms

Avoid excessive animations.

Avoid giant cards everywhere.

Data tables must remain practical on desktop.

---

# 42. CUSTOMER CREATION FORM

Sections:

BASIC

Business Name *
Contact Person
Customer Code
Phone *
Alternate Phone
Email

CLASSIFICATION

Customer Type
Area
Route
Salesman
Tags
Status

WHATSAPP

Opted In
Opt-in Date
Opt-in Source

ADDRESS

Address
City
District
State
PIN Code
Country

NOTES

Initial Note

Validate phone before save.

---

# 43. SOFT DELETE / ARCHIVING

Do not hard-delete important business records casually.

Customers should normally be archived.

Users should normally be deactivated.

Campaign records should remain for audit/history.

Messages must not disappear merely because a customer is archived.

---

# 44. SECURITY

Implement:

Server-side authorization
Secure password hashing
CSRF protection where relevant
Secure cookies
Input validation
SQL injection protection through parameterized ORM/query methods
Webhook signature verification
Rate limiting on login
Protected environment variables
No secrets in client bundles

Do not log:

Passwords
Access tokens
Full sensitive environment values

Mask secrets in settings UI.

---

# 45. AUDITING

Audit important actions:

User created
User disabled
Customer archived
Bulk update
Import
Campaign created
Campaign started
Campaign paused
Campaign cancelled
Opt-in changed
Opt-out changed
WhatsApp settings changed

AuditLog:

id
userId nullable
action
entityType
entityId nullable
metadata JSONB
createdAt

---

# 46. ERROR HANDLING

Do not use generic:

"Something went wrong"

when useful information is available.

Examples:

Invalid phone number
Template not approved
Customer opted out
Meta authentication failed
WhatsApp rate limited request
Campaign already started
Duplicate customer
Invalid spreadsheet row

Store technical details server-side.

Show safe, understandable messages in UI.

---

# 47. META API ERRORS

Build an adapter/service:

WhatsAppService

Methods such as:

testConnection()
sendTemplateMessage()
sendTextMessage()
getTemplates()
parseWebhook()
downloadMedia() if needed later

Do not call Meta APIs directly throughout the codebase.

Map Meta errors into internal typed errors.

This allows the external provider implementation to change later without rewriting CRM logic.

---

# 48. MEDIA

For V1:

Support receiving common WhatsApp message types.

At minimum:

Text
Image
Document

If media storage/download implementation adds significant complexity, build the data model and safe handling first and clearly document remaining work.

Do not block the entire inbox feature because advanced media handling is incomplete.

---

# 49. DATABASE INDEXES

Add intentional indexes.

Examples:

Customer.phoneNormalized

Customer.businessName

Customer.customerCode

Customer.status

Customer.assignedUserId

Customer.areaId

Customer.routeId

Customer.customerTypeId

FollowUp.assignedUserId + dueAt

FollowUp.status + dueAt

Message.whatsappMessageId

Message.customerId + createdAt

Conversation.lastMessageAt

Campaign.status

CampaignRecipient.campaignId + status

CampaignRecipient.whatsappMessageId

Do not add indexes blindly.

---

# 50. PAGINATION

Never load all 50,000 future customers into the browser.

Use server-side pagination.

Use appropriate pagination for:

Customers
Campaign recipients
Messages where necessary
Activity log
Reports

Inbox conversation pagination should be efficient.

---

# 51. SEED DATA

Create development seed data.

Include:

1 Admin

admin@example.com

Use a development-only password documented in README and require it to be changed for production.

Create:

3 salesmen
100 fake customers
Several customer types
Several areas
Several routes
Tags
Follow-ups
Conversations
Sample messages
Sample campaign
Campaign metrics

DO NOT use actual customer information.

---

# 52. MOCK WHATSAPP MODE

This is important.

Development must not require real Meta credentials.

Create:

WHATSAPP_MODE=mock

or:

WHATSAPP_MODE=cloud

Mock mode should simulate:

Send accepted
Delivered
Read
Incoming reply
Failed send

This allows the complete CRM to be developed and tested before connecting the real WhatsApp number.

Clearly display:

"WhatsApp Mock Mode"

when enabled.

Never accidentally send real messages while mock mode is active.

---

# 53. TESTING

Add meaningful tests.

At minimum test:

Phone normalization
Duplicate detection
Segment filtering
Campaign recipient snapshot
Opt-out exclusion
Campaign duplicate protection
Follow-up status
Webhook idempotency
Message status updates
Authorization
Template requirement logic
Campaign state transitions

Use the current appropriate testing framework for the stack.

Do not chase 100% code coverage.

Focus on critical business behavior.

---

# 54. CAMPAIGN STATE MACHINE

Campaign state transitions must be controlled.

Example:

DRAFT
→ SCHEDULED

DRAFT
→ QUEUED

SCHEDULED
→ QUEUED

QUEUED
→ SENDING

SENDING
→ PAUSED

PAUSED
→ SENDING

SENDING
→ COMPLETED

SENDING
→ CANCELLED

Do not allow nonsensical transitions such as:

COMPLETED → DRAFT

Centralize state transition validation.

---

# 55. CUSTOMER TIMELINE

Create a service capable of merging:

Activities
Notes
Follow-ups
Messages
Campaign events

into a chronological customer timeline.

Avoid unnecessarily duplicating all data into one giant table.

---

# 56. PERFORMANCE

For ~1,000 customers performance should feel instant.

Architecture should comfortably support significantly more customers.

Use:

Proper indexes
Server-side queries
Pagination
Selective fields
Avoid N+1 queries
Debounced search
Database aggregation for reporting

Do not prematurely introduce microservices.

This should remain a modular monolith.

---

# 57. CONFIGURATION

Create Settings module.

Sections:

GENERAL
Business Name
Timezone
Default Phone Country
Date Format

WHATSAPP
API configuration
Connection test
Webhook status

CUSTOMERS
Customer types
Areas
Routes
Tags

USERS
User management

CAMPAIGNS
Default send rate
Test numbers

System timezone should default through configuration rather than being scattered throughout code.

---

# 58. INDIA-FRIENDLY DEFAULTS

The business will initially operate in India.

Therefore sensible defaults may be:

Country: India
Phone Country: IN
Currency if required: INR
Timezone: Asia/Kolkata
Date presentation: DD/MM/YYYY

However these must remain configurable.

Do not hardcode them deep inside business logic.

---

# 59. ENVIRONMENT VARIABLES

Create a comprehensive:

.env.example

Include database, auth and WhatsApp settings.

Example categories:

DATABASE_URL

AUTH_SECRET

APP_URL

DEFAULT_PHONE_COUNTRY

APP_TIMEZONE

META_GRAPH_API_VERSION

WHATSAPP_MODE

WHATSAPP_ACCESS_TOKEN

WHATSAPP_PHONE_NUMBER_ID

WHATSAPP_BUSINESS_ACCOUNT_ID

WHATSAPP_WEBHOOK_VERIFY_TOKEN

META_APP_SECRET

WHATSAPP_SEND_BATCH_SIZE

WHATSAPP_SEND_RATE_LIMIT

Do not commit real secrets.

---

# 60. README

Write a proper README.

Include:

Project overview
Technology stack
Prerequisites
Installation
Environment configuration
Database setup
Migrations
Seed data
Starting development server
Starting worker
Mock WhatsApp mode
Cloud API setup
Webhook setup
Production deployment
Database backups
Security notes

Commands should work as documented.

---

# 61. NPM COMMANDS

Provide convenient commands similar to:

npm run dev
npm run build
npm run start
npm run lint
npm run test
npm run db:migrate
npm run db:seed
npm run worker

Adjust to actual chosen tooling.

---

# 62. CODE QUALITY

Use:

Strict TypeScript
Useful types
Small components
Reusable services
Consistent naming
Repository/service separation
Schema validation
Centralized error handling

Avoid:

any everywhere
huge files
huge route handlers
duplicated API logic
duplicated validation
magic strings
hardcoded credentials
console.log debugging throughout production code

---

# 63. ACCESSIBILITY

Forms need labels.

Buttons need understandable labels.

Keyboard navigation should function.

Use proper dialog focus management.

Do not sacrifice accessibility for aesthetics.

---

# 64. FIRST-RUN EXPERIENCE

When the application is opened initially:

Admin logs in.

Show setup checklist:

1. Business Settings
2. Add Users
3. Configure Customer Types
4. Import Customers
5. Connect WhatsApp
6. Sync Templates
7. Create First Segment
8. Send Test Campaign

Show setup progress.

---

# 65. SAFETY BEFORE MASS SEND

Before sending a campaign:

Show audience count prominently.

Require preview.

Highlight exclusions.

Require test send for a new template if practical.

For sufficiently large campaigns, show a confirmation such as:

"You are about to send this campaign to 863 customers."

Require explicit confirmation.

Avoid accidental duplicate campaign submission if the user double-clicks.

Use idempotency where necessary.

---

# 66. CAMPAIGN ELIGIBILITY

A promotional campaign recipient must pass all relevant checks:

Customer active

Not archived

Not DO_NOT_CONTACT

WhatsApp opted-in

Not opted-out

Valid normalized phone

Template valid

No duplicate within campaign

Any applicable current WhatsApp restrictions

Return exclusion reasons.

Example:

52 No WhatsApp Opt-In
6 Invalid Phone
3 Do Not Contact
1 Duplicate

---

# 67. CUSTOMER BULK ACTIONS

Customer table multi-select actions:

Assign Salesman
Add Tag
Remove Tag
Set Customer Type
Set Route
Set Area
Change Status
Export
Create Segment from Selection

Do not provide "Send WhatsApp immediately" as an unsafe one-click bulk action.

Bulk WhatsApp should go through Campaign flow.

---

# 68. SAVED FILTERS

Users should optionally save common customer filters.

Examples:

My HoReCa Customers
Manjeri Customers
Inactive Customers
No Contact 30 Days

SavedCustomerView:

id
name
userId
filterDefinition JSONB
createdAt
updatedAt

---

# 69. NOTIFICATIONS

Keep notifications simple.

In-app indicators:

Overdue follow-ups
Unread customer messages

Do not build a complex notification platform in V1.

---

# 70. SALES CONVERSION

We do not need a full sales order module.

CampaignRecipient can be manually classified as:

INTERESTED
NOT_INTERESTED
NEEDS_FOLLOWUP
ORDER_CONFIRMED
OTHER

When marking ORDER_CONFIRMED:

Optionally allow:

Order Reference
Approximate Amount
Note

Store lightweight conversion metadata.

Do NOT build invoice/order inventory logic.

---

# 71. SEARCH AND FILTER URL STATE

Where practical, maintain table filters/search/page in URL query parameters.

Example:

/customers?area=manjeri&type=horeca&page=2

This makes views shareable/bookmarkable internally.

---

# 72. MOBILE EXPERIENCE

Mobile experience should prioritize:

WhatsApp Inbox
Customer Search
Customer Details
Follow-ups
Add Note
Update Follow-up

Large reporting tables may remain desktop-oriented but must not break.

---

# 73. NO VENDOR LOCK-IN IN DOMAIN LOGIC

The application's domain should use terms such as:

Message
Campaign
Template
Conversation

Meta-specific payloads belong inside the WhatsApp integration layer.

Store external IDs where necessary.

This keeps the CRM maintainable.

---

# 74. DATA PRIVACY

Customer information is business-confidential.

Do not expose:

Customer lists publicly
Phone numbers in public URLs
API tokens
Webhook secrets

All CRM pages require authentication.

Add authorization to API routes.

---

# 75. DEVELOPMENT PROCESS

Build incrementally.

Do not attempt to generate the entire application in one giant unverified change.

Recommended development milestones:

MILESTONE 1
Project foundation
Authentication
Database
Navigation
Users
Settings

MILESTONE 2
Customer master
Customer types
Areas
Routes
Tags
Search
Filters

MILESTONE 3
CSV/XLSX import
Duplicate detection
Export
Segments

MILESTONE 4
Follow-ups
Notes
Activity timeline
Dashboard basics

MILESTONE 5
WhatsApp abstraction
Mock provider
Inbox
Messages
Conversations

MILESTONE 6
Meta Cloud API connection
Webhook
Template sync

MILESTONE 7
Campaign creation
Audience snapshot
Worker
Sending
Delivery/read statuses

MILESTONE 8
Campaign analytics
Reports
Response classification
Conversion tracking

MILESTONE 9
Testing
Security review
UX polish
Performance review
README
Production preparation

At the end of each milestone:

Run typecheck
Run lint
Run tests
Run build

Fix failures before proceeding.

---

# 76. DO NOT ASK FOR CONSTANT CONFIRMATION

When requirements are already clear:

Make a reasonable engineering decision and continue.

If a technical implementation detail is ambiguous:

Choose the simplest robust solution consistent with this specification.

Document major architectural decisions.

Do not stop development over trivial choices such as naming minor components.

Only raise issues when they materially affect:

Security
Data integrity
WhatsApp compliance
Architecture
Irreversible design decisions

---

# 77. DO NOT FAKE COMPLETION

Do not mark a feature complete if it is only a static UI.

A module is complete only when:

UI works
Database persists
Validation works
Authorization works
Errors are handled
Relevant tests pass

Do not create fake buttons that do nothing.

If something must remain incomplete because external credentials are unavailable, implement it using the mock WhatsApp provider and clearly document what will activate when credentials are supplied.

---

# 78. REAL META CONNECTION SHOULD BE OPTIONAL DURING BUILD

We will initially develop without production WhatsApp credentials.

Therefore:

Build the CRM completely in mock mode first.

After the core CRM is stable we will provide:

Meta app credentials
WhatsApp Business Account ID
Phone Number ID
Permanent/system access token as appropriate
Webhook configuration

Do not block development waiting for these values.

---

# 79. FUTURE EXTENSIONS

Design the schema so these can be added later, but DO NOT implement them now:

Route order taking
Customer outstanding balance
Billing software integration
Sales history import
Product-interest tracking
Automated re-engagement campaigns
AI reply suggestions
AI conversation summaries
AI campaign response classification
Customer scoring
Payment reminders
Salesman route planning
Mobile app
Tally integration

Do not build speculative features now.

---

# 80. MAIN WORKFLOWS THAT MUST WORK

WORKFLOW A — IMPORT CUSTOMERS

Login
→ Customers
→ Import
→ Upload XLSX
→ Map columns
→ Validate
→ Review duplicates
→ Import
→ Customer records available

WORKFLOW B — CREATE SEGMENT

Customers
→ Filters
→ Customer Type = HoReCa
→ Area = Manjeri
→ WhatsApp Opt-In = Yes
→ Save Segment
→ "Manjeri HoReCa"

WORKFLOW C — FOLLOW-UP

Customer
→ Add Follow-up
→ Assign salesman
→ Due tomorrow
→ Appears on salesman dashboard
→ Salesman completes
→ Outcome recorded
→ Timeline updated

WORKFLOW D — WHATSAPP INBOUND

Customer sends WhatsApp
→ Meta webhook
→ Existing customer matched by normalized phone
→ Conversation created/updated
→ Message displayed
→ Unread count updated
→ Customer timeline updated

If phone is unknown:

Create an "Unmatched Contact" flow.

Do not automatically create dirty customer records without review.

WORKFLOW E — REPLY

User opens inbox
→ Select customer
→ View conversation
→ If service window allows free-form response, reply
→ Otherwise choose approved template
→ Send
→ Message state updates through webhook

WORKFLOW F — CAMPAIGN

Campaigns
→ New Campaign
→ Choose segment
→ Select template
→ Map variables
→ Preview
→ Send test
→ Review recipients
→ Confirm
→ Queue
→ Worker sends
→ Meta returns message IDs
→ Webhooks update sent/delivered/read
→ Dashboard updates

WORKFLOW G — RESPONSE

Customer replies to campaign
→ Inbox receives message
→ Campaign recipient marked replied
→ Staff classifies response
→ Create follow-up if needed
→ Eventually mark order confirmed if appropriate

---

# 81. ACCEPTANCE CRITERIA

The application is ready for first production trial when:

1. Admin can authenticate securely.

2. Admin can create users.

3. 1,000 customers can be imported from XLSX without browser failure.

4. Duplicate phone numbers are detected.

5. Customer filters work.

6. Dynamic segments work.

7. Customer notes work.

8. Follow-ups work.

9. Salesmen can view their customers/follow-ups.

10. WhatsApp mock mode works end-to-end.

11. Real WhatsApp credentials can be configured through environment variables.

12. Meta webhook verification works.

13. Inbound WhatsApp messages attach to the correct customer.

14. Conversations display correctly.

15. Approved templates can be used for outbound template messages.

16. Campaign audiences exclude opted-out and invalid customers.

17. Campaigns snapshot recipients.

18. 1,000 campaign recipients can be queued without blocking the UI.

19. Worker processes recipients safely.

20. Duplicate campaign sends are prevented.

21. Delivery/read/failure webhooks update message status.

22. Campaign reports calculate correctly.

23. Replies appear in Inbox.

24. Customer timeline includes meaningful messaging and CRM activities.

25. Application survives restart while a campaign is partially processed.

26. Tests pass.

27. Production build succeeds.

28. README accurately explains setup.

---

# 82. FIRST TASK

Start by inspecting the repository.

If the repository is empty:

Initialize the project using the architecture in this specification.

Then create:

1. Application foundation
2. PostgreSQL configuration
3. Database schema
4. Migrations
5. Authentication
6. Role-based authorization
7. Base dashboard layout
8. Sidebar/navigation
9. User management
10. General settings

Then proceed to the Customer Master milestone.

Do not jump directly into Meta integration.

The CRM database and customer model are the foundation.

---

# 83. IMPLEMENTATION COMMUNICATION

While working:

Keep a concise implementation log.

For each milestone report:

Completed
Files/modules changed
Database changes
Tests performed
Anything requiring external configuration
Next milestone

Do not dump unnecessary explanations.

Focus on building.

---

# 84. FINAL PRODUCT PRINCIPLE

This application exists to answer four questions quickly:

WHO ARE MY CUSTOMERS?

WHO SHOULD I CONTACT?

WHAT DID WE DISCUSS?

WHAT SHOULD I DO NEXT?

Every feature should support one of those questions.

Keep the product simple enough for everyday use.

The goal is not to build the biggest CRM.

The goal is to build a CRM that the business actually uses every day.

Begin implementation now.