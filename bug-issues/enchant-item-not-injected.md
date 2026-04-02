# Bug Report: enchantItem Not Injected into mc_execute Sandbox

## Symptom
The `enchantItem()` helper function is defined in `src/tools/mc-execute.ts` (line 1717) and appears in the compiled `dist/tools/mc-execute.js` (line 1672) but is NOT available inside the mc_execute sandbox.

```javascript
// This fails:
await enchantItem('diamond_pickaxe', 2);
// Error: enchantItem is not defined
```

## Evidence

### 1. Source Code Status
- **File**: `src/tools/mc-execute.ts`
- **Line**: 1717 (enchantItem function definition start)
- **Line**: 1855 (properly closed with `},`)
- **Status**: ✅ Defined with correct syntax

### 2. Compiled Code Status
- **File**: `dist/tools/mc-execute.js`
- **Line**: 1672 (enchantItem definition)
- **Line**: 1796 (properly closed)
- **Status**: ✅ Present in compiled output

### 3. Sandbox Context Status
- **ctx object definition**: Lines 456-1935 in compiled code
- **enchantItem position**: Line 1672 (within ctx object range)
- **Status**: ✅ Syntactically within ctx object definition

### 4. Runtime Check
```javascript
// Works:
typeof awareness      // "function"
typeof log            // "function"
typeof bot            // "object"

// Fails:
typeof enchantItem    // "undefined"
'enchantItem' in globalThis  // false
```

## Root Cause Analysis
The enchantItem function IS defined in the ctx object and IS compiled into dist/tools/mc-execute.js, but the function is NOT appearing in the `keys` array that gets passed to the AsyncFunction constructor at line 1940 of the compiled code.

Possible causes:
1. **Object.keys(ctx) not picking up enchantItem**: This would happen if there's a scope issue or a closing brace creating a nested object
2. **Compilation issue**: TypeScript might not be preserving the property during compilation
3. **ctx object structure**: The enchantItem might be defined outside the actual ctx object literal due to a missing brace

## Reproduction
```bash
BOT_USERNAME=Claude1 node scripts/mc-execute.cjs "
const result = await enchantItem('diamond_pickaxe', 2);
log(JSON.stringify(result));
"
```

Output: `Error: enchantItem is not defined`

## Fix Required
- Verify that enchantItem is properly included in the ctx object definition
- Check if there's a missing closing brace or syntax error that's creating a nested structure
- Verify Object.keys(ctx) includes 'enchantItem' at runtime
- Consider adding a console.log of ctx keys during sandbox construction to debug

## Status
Reported: 2026-04-02
