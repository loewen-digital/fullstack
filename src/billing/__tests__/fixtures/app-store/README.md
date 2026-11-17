# App Store fixtures

Payloads of Apple's in-app purchase as the App Store driver reads them: three transactions
(`JWSTransactionDecodedPayload`) and two App Store Server Notifications of version 2
(`responseBodyV2DecodedPayload`), decoded. They are built from Apple's reference
(https://developer.apple.com/documentation/appstoreserverapi and
https://developer.apple.com/documentation/appstoreservernotifications, read 2026-11-17), with the
fields a sandbox purchase carries. They are **not recorded**: no sandbox account was at hand. The
ids, the bundle id and the products are made up, and `appAccountToken` is the token of the test
user `u1`.

Nothing here is signed. A test signs a payload with a certificate chain it makes for the run
(`../../app-store-chain.ts`) and tells the driver to trust that root. In a notification,
`data.transaction` and `data.renewalInfo` stand where Apple sends `signedTransactionInfo` and
`signedRenewalInfo`; the test signs each on its own, as Apple does. A recording replaces these
files the same way: the payloads decoded, scrubbed of the customer, and signed anew by the test.

What Apple's reference names without showing (a renewal, a cancel, a refund, an upgrade) a test
derives from these files and says so where it does.

`apple-certificates.json` holds two real certificates of Apple, both public: the intermediate
"Apple Worldwide Developer Relations Certification Authority G6" and a signing certificate of the
App Store ("Prod ECC Mac App Store and iTunes Store Receipt Signing", valid 2025-09-19 to
2027-10-13), as they stand in the tests of Apple's own server library
(https://github.com/apple/app-store-server-library-node), and the SHA-256 fingerprint of Apple Root
CA - G3 as it is in the trust store of macOS. They check that the driver reads Apple's real chain;
no key and no customer is in them.
