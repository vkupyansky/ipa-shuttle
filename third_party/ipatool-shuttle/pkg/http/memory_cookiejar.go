package http

import (
	"net/http"
	"net/http/cookiejar"
	"net/url"
)

type memoryCookieJar struct {
	jar *cookiejar.Jar
}

func NewMemoryCookieJar() (CookieJar, error) {
	jar, err := cookiejar.New(nil)
	if err != nil {
		return nil, err
	}

	return &memoryCookieJar{jar: jar}, nil
}

func (j *memoryCookieJar) SetCookies(u *url.URL, cookies []*http.Cookie) {
	j.jar.SetCookies(u, cookies)
}

func (j *memoryCookieJar) Cookies(u *url.URL) []*http.Cookie {
	return j.jar.Cookies(u)
}

func (j *memoryCookieJar) Save() error {
	return nil
}
