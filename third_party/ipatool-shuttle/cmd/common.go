package cmd

import (
	"io"
	"os"

	"github.com/majd/ipatool/v2/pkg/appstore"
	"github.com/majd/ipatool/v2/pkg/http"
	"github.com/majd/ipatool/v2/pkg/keychain"
	"github.com/majd/ipatool/v2/pkg/log"
	"github.com/majd/ipatool/v2/pkg/util"
	"github.com/majd/ipatool/v2/pkg/util/machine"
	"github.com/majd/ipatool/v2/pkg/util/operatingsystem"
	"github.com/rs/zerolog"
	"github.com/spf13/cobra"
)

var dependencies = Dependencies{}

type Dependencies struct {
	Logger   log.Logger
	Machine  machine.Machine
	AppStore appstore.AppStore
}

// newLogger returns a new logger instance.
func newLogger(format OutputFormat, verbose bool) log.Logger {
	var writer io.Writer

	switch format {
	case OutputFormatJSON:
		writer = zerolog.SyncWriter(os.Stdout)
	case OutputFormatText:
		writer = log.NewWriter()
	}

	return log.NewLogger(log.Args{
		Verbose: verbose,
		Writer:  writer,
	},
	)
}

// newCookieJar returns a new cookie jar instance.
func newCookieJar() http.CookieJar {
	if sessionFile := os.Getenv("IPASHUTTLE_AUTH_SESSION_FILE"); sessionFile != "" {
		return util.Must(http.NewSessionCookieJar(sessionFile))
	}
	return util.Must(http.NewMemoryCookieJar())
}

// newSessionBridge returns the IPA Shuttle in-memory/file session bridge.
func newSessionBridge() keychain.Keychain {
	sessionFile := os.Getenv("IPASHUTTLE_AUTH_SESSION_FILE")
	return keychain.NewShuttle(keychain.ShuttleArgs{SessionFile: sessionFile})
}

// initWithCommand initializes the dependencies of the command.
func initWithCommand(cmd *cobra.Command) {
	verbose := cmd.Flag("verbose").Value.String() == "true"
	format := util.Must(OutputFormatFromString(cmd.Flag("format").Value.String()))

	dependencies.Logger = newLogger(format, verbose)
	operatingSystem := operatingsystem.New()
	dependencies.Machine = machine.New(machine.Args{OS: operatingSystem})
	cookieJar := newCookieJar()
	sessionBridge := newSessionBridge()
	dependencies.AppStore = appstore.NewAppStore(appstore.Args{
		CookieJar:       cookieJar,
		OperatingSystem: operatingSystem,
		Keychain:        sessionBridge,
		Machine:         dependencies.Machine,
	})
}
