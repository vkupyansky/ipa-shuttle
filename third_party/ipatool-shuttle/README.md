# ipatool-shuttle

This directory vendors the MIT-licensed `ipatool` code used by IPA Shuttle's
internal Apple auth/download engine. It is not a user-facing CLI distribution.

The local fork exposes only the commands required by the Rust backend:

- `auth login`, including the live 2FA stdin flow;
- `download`, including license acquisition requested by IPA Shuttle.

The engine does not call macOS Keychain APIs. Account and cookie state is read
from and written to the private session file supplied by the IPA Shuttle
process through `IPASHUTTLE_AUTH_SESSION_FILE`; memory-only operation is used
when no file is supplied. Passwords are never written to that file.

Build and verify:

```bash
go generate ./pkg/keychain ./pkg/http ./pkg/log ./pkg/util/machine ./pkg/util/operatingsystem
gofmt -w $(find . -name '*.go' -type f)
go test ./...
go vet ./...
../../scripts/build-engine.sh
```

Upstream copyright and the MIT license are preserved in [LICENSE](LICENSE).
