This library provides feature flag querying functionality for determining which application features are enabled for a specific user.

## Installing
To add the latset published version of this package to your application:

```bash
npm install wm-feature-flag-client
```
## Dev setup
```bash
npm install wm-feature-flag-client
cd wm-feature-flag-client
npm i
npm run build
```

## Example usage
```
const context = {
  userId: {USER_ID},
  configUrl: {CONFIG_URL},
  Platform: ["iOS, Windows"],
  Brand: ["myBrand"]
}

const client = new FeatureFlagClient(context)
const featureFlag = await client.queryFeatureFlag('feature-a')

console.log(featureFlag.enabled) // true or false
```

## To do
Expanded readme forthcoming
