package keychain

import (
	"encoding/json"
	"fmt"
	"os"
	"sync"
)

type shuttleKeychain struct {
	sessionFile string
	mu          sync.Mutex
	memory      map[string][]byte
}

type ShuttleArgs struct {
	SessionFile string
}

func NewShuttle(args ShuttleArgs) Keychain {
	return &shuttleKeychain{
		sessionFile: args.SessionFile,
		memory:      map[string][]byte{},
	}
}

func (k *shuttleKeychain) Get(key string) ([]byte, error) {
	k.mu.Lock()
	defer k.mu.Unlock()

	if k.sessionFile != "" {
		data, err := os.ReadFile(k.sessionFile)
		if err != nil {
			return nil, fmt.Errorf("failed to read shuttle session file: %w", err)
		}

		return data, nil
	}

	data, ok := k.memory[key]
	if !ok {
		return nil, fmt.Errorf("shuttle session item not found")
	}

	return append([]byte(nil), data...), nil
}

func (k *shuttleKeychain) Set(key string, data []byte) error {
	k.mu.Lock()
	defer k.mu.Unlock()

	if k.sessionFile != "" {
		merged, err := mergeSessionCookies(k.sessionFile, data)
		if err != nil {
			return err
		}
		return os.WriteFile(k.sessionFile, merged, 0600)
	}

	k.memory[key] = append([]byte(nil), data...)
	return nil
}

func mergeSessionCookies(path string, data []byte) ([]byte, error) {
	var incoming map[string]json.RawMessage
	if err := json.Unmarshal(data, &incoming); err != nil {
		return nil, fmt.Errorf("failed to decode shuttle account: %w", err)
	}

	existingData, err := os.ReadFile(path)
	if err != nil && !os.IsNotExist(err) {
		return nil, fmt.Errorf("failed to read shuttle session: %w", err)
	}
	if len(existingData) > 0 {
		var existing map[string]json.RawMessage
		if err := json.Unmarshal(existingData, &existing); err != nil {
			return nil, fmt.Errorf("failed to decode shuttle session: %w", err)
		}
		if cookies, ok := existing["cookies"]; ok {
			incoming["cookies"] = cookies
		}
	}

	merged, err := json.Marshal(incoming)
	if err != nil {
		return nil, fmt.Errorf("failed to encode shuttle session: %w", err)
	}
	return merged, nil
}
