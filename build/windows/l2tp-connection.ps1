# Adds the L2TP/IPsec connection that Digi Cyber dials with rasdial.
# The app passes the values in the environment, so they are never read as PowerShell code.
$ErrorActionPreference = 'Stop'
$name = $env:DC_L2TP_NAME
Remove-VpnConnection -Name $name -Force -ErrorAction SilentlyContinue
Add-VpnConnection -Name $name -ServerAddress $env:DC_L2TP_SERVER -TunnelType L2tp -L2tpPsk $env:DC_L2TP_PSK -AuthenticationMethod MSChapv2 -EncryptionLevel Optional -Force
