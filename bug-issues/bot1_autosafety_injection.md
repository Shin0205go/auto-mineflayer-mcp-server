## Bug: safetyState not injected into mc_execute sandbox

### Status: RESOLVED — daemon再起動で解決

### Root Cause
古いdaemonプロセスが動いていたため、新しいAutoSafetyコードが反映されていなかった。
daemon再起動 + bot再接続で `safetyState` が正常に注入されることを確認。

### Verification
```
BOT_USERNAME=Claude1 node scripts/mc-execute.cjs "log('safetyState: ' + JSON.stringify(safetyState))"
```
出力:
```
safetyState: {"autoEatActive":false,"creeperFleeActive":false,"emergencyDodgeActive":false,"autoSleepActive":false,"lastAction":null,"lastActionTime":0}
```
