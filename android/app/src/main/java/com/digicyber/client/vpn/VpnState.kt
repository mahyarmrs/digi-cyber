package com.digicyber.client.vpn

import kotlinx.coroutines.flow.MutableStateFlow
import com.digicyber.client.data.Status

object VpnState {
    val status = MutableStateFlow(Status())
}
