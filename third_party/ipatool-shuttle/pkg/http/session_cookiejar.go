package http

import (
	"encoding/json"
	"fmt"
	gohttp "net/http"
	"net/http/cookiejar"
	"net/url"
	"os"
	"sort"
	"sync"
)

type persistedCookieSet struct {
	URL     string           `json:"url"`
	Cookies []*gohttp.Cookie `json:"cookies"`
}

type sessionCookieJar struct {
	mu          sync.Mutex
	jar         *cookiejar.Jar
	sessionFile string
	sets        map[string][]*gohttp.Cookie
}

func NewSessionCookieJar(sessionFile string) (CookieJar, error) {
	jar, err := cookiejar.New(nil)
	if err != nil {
		return nil, err
	}

	result := &sessionCookieJar{
		jar:         jar,
		sessionFile: sessionFile,
		sets:        map[string][]*gohttp.Cookie{},
	}
	if err := result.load(); err != nil {
		return nil, err
	}
	return result, nil
}

func (j *sessionCookieJar) SetCookies(u *url.URL, cookies []*gohttp.Cookie) {
	j.mu.Lock()
	defer j.mu.Unlock()

	j.jar.SetCookies(u, cookies)
	key := cookieURLKey(u)
	j.sets[key] = mergeCookies(j.sets[key], cookies)
}

func (j *sessionCookieJar) Cookies(u *url.URL) []*gohttp.Cookie {
	j.mu.Lock()
	defer j.mu.Unlock()
	return j.jar.Cookies(u)
}

func (j *sessionCookieJar) Save() error {
	j.mu.Lock()
	defer j.mu.Unlock()

	document, err := readSessionDocument(j.sessionFile)
	if err != nil {
		return err
	}

	keys := make([]string, 0, len(j.sets))
	for key := range j.sets {
		keys = append(keys, key)
	}
	sort.Strings(keys)

	sets := make([]persistedCookieSet, 0, len(keys))
	for _, key := range keys {
		sets = append(sets, persistedCookieSet{URL: key, Cookies: j.sets[key]})
	}
	encodedCookies, err := json.Marshal(sets)
	if err != nil {
		return fmt.Errorf("failed to encode shuttle cookies: %w", err)
	}
	document["cookies"] = encodedCookies

	encoded, err := json.Marshal(document)
	if err != nil {
		return fmt.Errorf("failed to encode shuttle session: %w", err)
	}
	if err := os.WriteFile(j.sessionFile, encoded, 0600); err != nil {
		return fmt.Errorf("failed to persist shuttle cookies: %w", err)
	}
	return nil
}

func (j *sessionCookieJar) load() error {
	document, err := readSessionDocument(j.sessionFile)
	if err != nil {
		return err
	}
	raw, ok := document["cookies"]
	if !ok {
		return nil
	}

	var sets []persistedCookieSet
	if err := json.Unmarshal(raw, &sets); err != nil {
		return fmt.Errorf("failed to decode shuttle cookies: %w", err)
	}
	for _, set := range sets {
		u, err := url.Parse(set.URL)
		if err != nil || u.Scheme == "" || u.Host == "" {
			continue
		}
		j.jar.SetCookies(u, set.Cookies)
		j.sets[set.URL] = cloneCookies(set.Cookies)
	}
	return nil
}

func readSessionDocument(path string) (map[string]json.RawMessage, error) {
	document := map[string]json.RawMessage{}
	data, err := os.ReadFile(path)
	if os.IsNotExist(err) {
		return document, nil
	}
	if err != nil {
		return nil, fmt.Errorf("failed to read shuttle session: %w", err)
	}
	if len(data) == 0 {
		return document, nil
	}
	if err := json.Unmarshal(data, &document); err != nil {
		return nil, fmt.Errorf("failed to decode shuttle session: %w", err)
	}
	return document, nil
}

func cookieURLKey(u *url.URL) string {
	return (&url.URL{Scheme: u.Scheme, Host: u.Host}).String()
}

func mergeCookies(current, updates []*gohttp.Cookie) []*gohttp.Cookie {
	byKey := map[string]*gohttp.Cookie{}
	for _, cookie := range current {
		byKey[cookieIdentity(cookie)] = cloneCookie(cookie)
	}
	for _, cookie := range updates {
		key := cookieIdentity(cookie)
		if cookie.MaxAge < 0 {
			delete(byKey, key)
			continue
		}
		byKey[key] = cloneCookie(cookie)
	}

	keys := make([]string, 0, len(byKey))
	for key := range byKey {
		keys = append(keys, key)
	}
	sort.Strings(keys)
	result := make([]*gohttp.Cookie, 0, len(keys))
	for _, key := range keys {
		result = append(result, byKey[key])
	}
	return result
}

func cookieIdentity(cookie *gohttp.Cookie) string {
	return cookie.Name + "\x00" + cookie.Domain + "\x00" + cookie.Path
}

func cloneCookies(cookies []*gohttp.Cookie) []*gohttp.Cookie {
	result := make([]*gohttp.Cookie, 0, len(cookies))
	for _, cookie := range cookies {
		result = append(result, cloneCookie(cookie))
	}
	return result
}

func cloneCookie(cookie *gohttp.Cookie) *gohttp.Cookie {
	copy := *cookie
	copy.Unparsed = append([]string(nil), cookie.Unparsed...)
	return &copy
}
