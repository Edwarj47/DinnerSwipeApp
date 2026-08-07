# Known Limitations

- Native mobile file picking is deferred; mobile web upload works.
- Native photo picking still needs the Expo image picker integration. Web image upload is available now.
- Image copying/storage is represented by status and storage abstraction notes, but the MVP stores validated source URLs and user-uploaded files in the app media volume.
- Background worker is a polling shell; most MVP processing runs inline for local usability.
- Unit conversion is conservative and aggregates only matching normalized item plus unit pairs.
- Web auth uses local storage for development; production should move to a hardened cookie/session strategy.
- Native biometric unlock protects the local saved session on the device. It is not a server-side biometric credential and does not replace email/password.
- Refresh tokens rotate and revoke server-side, but there is not yet a user-facing multi-device session management screen.
- Auth rate limiting is in-process for the current single API container. Use Redis or edge/WAF limits before horizontal API scaling.
- Azure Blob media storage is adapter-ready but not enabled until Azure credentials, a container, and a public media base URL are configured.
- npm audit reports vulnerabilities in the Expo dependency tree. Do not force-upgrade without validating Expo compatibility.
- Group voting is implemented as a first-pass household weekly vote summary. It does not yet auto-rank, auto-select, or resolve ties.
- Stripe Premium is adapter-ready but disabled until the Stripe connection/account and test-mode lifecycle are verified.
- Macro totals require manually entered macro values or reviewed recipe macro profiles. Dinner Swipe does not infer nutrition facts from recipe text by default.
