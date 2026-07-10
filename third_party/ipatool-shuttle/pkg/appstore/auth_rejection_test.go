package appstore

import (
	"errors"
	"testing"
)

func TestAuthRejectionPreservesSafeFailureType(t *testing.T) {
	err := newAuthRejectionError(FailureTypeDeviceVerificationFailed)

	if !errors.Is(err, ErrPasswordTokenExpired) {
		t.Fatal("auth rejection must remain classifiable as an expired token")
	}
	if err.Error() != "App Store request rejected (failure type 1008)" {
		t.Fatalf("unexpected safe error: %s", err)
	}
}
