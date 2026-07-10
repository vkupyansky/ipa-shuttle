package appstore

type App struct {
	ID       int64   `json:"trackId,omitempty"`
	BundleID string  `json:"bundleId,omitempty"`
	Name     string  `json:"trackName,omitempty"`
	Version  string  `json:"version,omitempty"`
	Price    float64 `json:"price,omitempty"`
}
