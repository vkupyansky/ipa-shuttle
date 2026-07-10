package cmd

import (
	"bufio"
	"errors"
	"fmt"
	"os"
	"strings"
	"time"

	"github.com/avast/retry-go"
	"github.com/majd/ipatool/v2/pkg/appstore"
	"github.com/majd/ipatool/v2/pkg/util"
	"github.com/spf13/cobra"
	"golang.org/x/term"
)

func authCmd() *cobra.Command {
	cmd := &cobra.Command{
		Use:   "auth",
		Short: "Authenticate with the App Store",
	}

	cmd.AddCommand(loginCmd())

	return cmd
}

func loginCmd() *cobra.Command {
	promptForAuthCode := func() (string, error) {
		authCode, err := bufio.NewReader(os.Stdin).ReadString('\n')
		if err != nil {
			return "", fmt.Errorf("failed to read string: %w", err)
		}

		authCode = strings.Trim(authCode, "\n")
		authCode = strings.Trim(authCode, "\r")

		return authCode, nil
	}

	var email, password, authCode string

	cmd := &cobra.Command{
		Use:   "login",
		Short: "Login to the App Store",
		RunE: func(cmd *cobra.Command, args []string) error {
			interactive := cmd.Context().Value(interactiveKey).(bool)

			if password == "" && os.Getenv("IPASHUTTLE_PASSWORD_STDIN") == "1" {
				value, err := bufio.NewReader(os.Stdin).ReadString('\n')
				if err != nil {
					return fmt.Errorf("failed to read password from shuttle stdin: %w", err)
				}
				password = strings.TrimRight(value, "\r\n")
			}

			if password == "" && !interactive {
				return errors.New("password is required for Apple ID sign-in")
			}

			if password == "" && interactive {
				dependencies.Logger.Log().Msg("enter password:")

				bytes, err := term.ReadPassword(int(os.Stdin.Fd()))
				if err != nil {
					return fmt.Errorf("failed to read password: %w", err)
				}
				password = string(bytes)
			}

			var lastErr error

			// nolint:wrapcheck
			return retry.Do(func() error {
				if errors.Is(lastErr, appstore.ErrAuthCodeRequired) && interactive {
					dependencies.Logger.Log().Msg("enter 2FA code:")

					var err error
					authCode, err = promptForAuthCode()
					if err != nil {
						return fmt.Errorf("failed to read auth code: %w", err)
					}
				}

				dependencies.Logger.Verbose().
					Str("password", "<redacted>").
					Str("email", email).
					Str("authCode", util.IfEmpty(maskAuthCode(authCode), "<nil>")).
					Msg("logging in")

				bag, err := dependencies.AppStore.Bag(appstore.BagInput{})
				if err != nil {
					return fmt.Errorf("failed to get bag: %w", err)
				}

				output, err := dependencies.AppStore.Login(appstore.LoginInput{
					Email:    email,
					Password: password,
					AuthCode: authCode,
					Endpoint: bag.AuthEndpoint,
				})
				if err != nil {
					if errors.Is(err, appstore.ErrAuthCodeRequired) && !interactive {
						dependencies.Logger.Log().Msg("2FA code is required; run the command again and supply a code using the `--auth-code` flag")

						return nil
					}

					return err
				}

				dependencies.Logger.Log().
					Str("name", output.Account.Name).
					Str("email", output.Account.Email).
					Bool("success", true).
					Send()

				return nil
			},
				retry.LastErrorOnly(true),
				retry.DelayType(retry.FixedDelay),
				retry.Delay(time.Millisecond),
				retry.Attempts(2),
				retry.RetryIf(func(err error) bool {
					lastErr = err

					return errors.Is(err, appstore.ErrAuthCodeRequired)
				}),
			)
		},
	}

	cmd.Flags().StringVarP(&email, "email", "e", "", "email address for the Apple ID (required)")
	cmd.Flags().StringVarP(&password, "password", "p", "", "password for the Apple ID (required)")
	cmd.Flags().StringVar(&authCode, "auth-code", "", "2FA code for the Apple ID")

	_ = cmd.MarkFlagRequired("email")

	return cmd
}

func maskAuthCode(authCode string) string {
	if authCode == "" {
		return ""
	}

	return "<redacted>"
}
