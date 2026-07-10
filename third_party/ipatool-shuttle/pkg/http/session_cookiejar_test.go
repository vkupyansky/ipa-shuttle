package http

import (
	"encoding/json"
	gohttp "net/http"
	"net/url"
	"os"
	"path/filepath"
	"testing"
)

func TestSessionCookieJarPersistsCookiesAlongsideAccount(t *testing.T) {
	path := filepath.Join(t.TempDir(), "session.json")
	if err := os.WriteFile(path, []byte(`{"email":"person@example.com"}`), 0600); err != nil {
		t.Fatal(err)
	}

	jar, err := NewSessionCookieJar(path)
	if err != nil {
		t.Fatal(err)
	}
	u, _ := url.Parse("https://buy.itunes.apple.com/")
	jar.SetCookies(u, []*gohttp.Cookie{{
		Name:   "mz_at0",
		Value:  "session-value",
		Domain: ".itunes.apple.com",
		Path:   "/",
		Secure: true,
	}})
	if err := jar.Save(); err != nil {
		t.Fatal(err)
	}

	raw, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	var document map[string]json.RawMessage
	if err := json.Unmarshal(raw, &document); err != nil {
		t.Fatal(err)
	}
	if _, ok := document["email"]; !ok {
		t.Fatal("account fields were not preserved")
	}
	if _, ok := document["cookies"]; !ok {
		t.Fatal("cookies were not persisted")
	}

	reloaded, err := NewSessionCookieJar(path)
	if err != nil {
		t.Fatal(err)
	}
	if cookies := reloaded.Cookies(u); len(cookies) != 1 || cookies[0].Name != "mz_at0" {
		t.Fatalf("unexpected reloaded cookies: %#v", cookies)
	}
}
