// Package core is the part of Xray-core the Android app calls, bound with gomobile:
// gomobile bind -target=android -androidapi 21 -javapkg com.digicyber.client ./
package core

import (
	"os"
	"strings"
	"sync"

	xcore "github.com/xtls/xray-core/core"
	"github.com/xtls/xray-core/infra/conf/serial"
	_ "github.com/xtls/xray-core/main/distro/all"
)

var (
	mu           sync.Mutex
	instance     *xcore.Instance
	pingMu       sync.Mutex
	pingInstance *xcore.Instance
	lifecycleMu  sync.Mutex
)

// SetAssetDir tells Xray where geoip.dat and geosite.dat are.
func SetAssetDir(dir string) {
	os.Setenv("xray.location.asset", dir)
	os.Setenv("XRAY_LOCATION_ASSET", dir)
}

// Start runs the JSON configuration, replacing one already running.
func Start(configJSON string) error {
	mu.Lock()
	defer mu.Unlock()
	lifecycleMu.Lock()
	defer lifecycleMu.Unlock()
	if instance != nil {
		instance.Close()
		instance = nil
	}
	config, err := serial.LoadJSONConfig(strings.NewReader(configJSON))
	if err != nil {
		return err
	}
	server, err := xcore.New(config)
	if err != nil {
		return err
	}
	if err := server.Start(); err != nil {
		server.Close()
		return err
	}
	instance = server
	return nil
}

func Stop() {
	mu.Lock()
	defer mu.Unlock()
	lifecycleMu.Lock()
	defer lifecycleMu.Unlock()
	if instance != nil {
		instance.Close()
		instance = nil
	}
}

// StartPing runs an isolated Xray instance for location checks without replacing the user's VPN.
func StartPing(configJSON string) error {
	pingMu.Lock()
	defer pingMu.Unlock()
	lifecycleMu.Lock()
	defer lifecycleMu.Unlock()
	if pingInstance != nil {
		pingInstance.Close()
		pingInstance = nil
	}
	config, err := serial.LoadJSONConfig(strings.NewReader(configJSON))
	if err != nil {
		return err
	}
	server, err := xcore.New(config)
	if err != nil {
		return err
	}
	if err := server.Start(); err != nil {
		server.Close()
		return err
	}
	pingInstance = server
	return nil
}

func StopPing() {
	pingMu.Lock()
	defer pingMu.Unlock()
	lifecycleMu.Lock()
	defer lifecycleMu.Unlock()
	if pingInstance != nil {
		pingInstance.Close()
		pingInstance = nil
	}
}

func IsRunning() bool {
	mu.Lock()
	defer mu.Unlock()
	return instance != nil
}

func Version() string {
	return xcore.Version()
}
