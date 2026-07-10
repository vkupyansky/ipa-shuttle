package keychain

import (
	"encoding/json"
	"os"
	"path/filepath"
	"testing"
)

func TestMergeSessionCookiesPreservesCookiePayload(t *testing.T) {
	path := filepath.Join(t.TempDir(), "session.json")
	if err := os.WriteFile(path, []byte(`{"cookies":[{"url":"https://buy.itunes.apple.com"}]}`), 0600); err != nil {
		t.Fatal(err)
	}

	merged, err := mergeSessionCookies(path, []byte(`{"email":"person@example.com","passwordToken":"token"}`))
	if err != nil {
		t.Fatal(err)
	}
	var document map[string]json.RawMessage
	if err := json.Unmarshal(merged, &document); err != nil {
		t.Fatal(err)
	}
	if _, ok := document["email"]; !ok {
		t.Fatal("account was not preserved")
	}
	if _, ok := document["cookies"]; !ok {
		t.Fatal("cookies were not preserved")
	}
}
