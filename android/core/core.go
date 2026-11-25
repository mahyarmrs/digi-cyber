// Package core is the part of Xray-core the Android app calls, bound with gomobile:
// gomobile bind -target=android -androidapi 21 -javapkg com.digicyber.client ./
package core

import (
	"errors"
	"os"
	"strings"
	"sync"

	xcore "github.com/xtls/xray-core/core"
	"github.com/xtls/xray-core/infra/conf/serial"
	_ "github.com/xtls/xray-core/main/distro/all"
)

const maxPingInstances = 2

var (
	mu            sync.Mutex
	instance      *xcore.Instance
	pingMu        sync.Mutex
	pingInstances [maxPingInstances]*xcore.Instance
	lifecycleMu   sync.Mutex
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
// Separate slots let Android check a few locations at once, like the desktop builds do.
func StartPing(slot int32, configJSON string) error {
	if slot < 0 || slot >= maxPingInstances {
		return errors.New("invalid ping instance slot")
	}
	pingMu.Lock()
	defer pingMu.Unlock()
	lifecycleMu.Lock()
	defer lifecycleMu.Unlock()
	if pingInstances[slot] != nil {
		pingInstances[slot].Close()
		pingInstances[slot] = nil
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
	pingInstances[slot] = server
	return nil
}

func StopPing(slot int32) {
	if slot < 0 || slot >= maxPingInstances {
		return
	}
	pingMu.Lock()
	defer pingMu.Unlock()
	lifecycleMu.Lock()
	defer lifecycleMu.Unlock()
	if pingInstances[slot] != nil {
		pingInstances[slot].Close()
		pingInstances[slot] = nil
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
