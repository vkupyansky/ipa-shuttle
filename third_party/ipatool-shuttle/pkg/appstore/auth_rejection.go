package appstore

import (
	"errors"
	"fmt"
)

var ErrPasswordTokenExpired = errors.New("password token is expired")

type authRejectionError struct {
	failureType string
}

func (e authRejectionError) Error() string {
	return fmt.Sprintf("App Store request rejected (failure type %s)", e.failureType)
}

func (e authRejectionError) Unwrap() error {
	return ErrPasswordTokenExpired
}

func newAuthRejectionError(failureType string) error {
	return authRejectionError{failureType: failureType}
}
