# Google Play fixtures

Purchases and notifications of Google Play Billing as the Google Play driver reads them: a
subscription (`SubscriptionPurchaseV2`) and a one-time purchase (`ProductPurchaseV2`) as the
Android Publisher API answers, and four real-time developer notifications
(`DeveloperNotification`), decoded. They are built from Google's reference (the discovery document
of the API, revision 20261117, https://developer.android.com/google/play/billing/rtdn-reference
and https://developer.android.com/google/play/billing/lifecycle/subscriptions, read 2026-11-17),
with the fields a purchase of a licence tester carries. They are **not recorded**: no app with
products in the Play Console was at hand. The package name, the products, the order ids and the
purchase tokens are made up.

Nothing here is a secret and nothing is signed. A test stands in for Google
(`../../google-play-fake.ts`): it answers the API from these files, and it signs the token of a
push request with a key it makes for the run. A notification is stored as Google publishes it
to the topic; the test wraps it in the message Cloud Pub/Sub delivers. A recording replaces
these files the same way: the answers of the API and the decoded notifications, scrubbed of the
customer (`regionCode`, order ids, purchase tokens, `externalAccountIdentifiers`,
`subscribeWithGoogleInfo`).

What Google's reference names without showing in full (a renewal, a cancel, a hold, a refund, a
change of plan) a test derives from these files and says so where it does.
