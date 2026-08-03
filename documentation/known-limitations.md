# Known Limitations

- Native mobile file picking is deferred; mobile web upload works.
- Native photo picking still needs the Expo image picker integration. Web image upload is available now.
- Image copying/storage is represented by status and storage abstraction notes, but the MVP stores validated source URLs and user-uploaded files in the app media volume.
- Background worker is a polling shell; most MVP processing runs inline for local usability.
- Unit conversion is conservative and aggregates only matching normalized item plus unit pairs.
- Web auth uses local storage for development; production should move to a hardened cookie/session strategy.
- npm audit reports vulnerabilities in the Expo dependency tree. Do not force-upgrade without validating Expo compatibility.
- Group voting is implemented as a first-pass household weekly vote summary. It does not yet auto-rank, auto-select, or resolve ties.
