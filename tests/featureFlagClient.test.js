const { expect, assert } = require('chai')
const sinon = require('sinon')
const sandbox = require('sinon').createSandbox()
const { FeatureFlagClient } = require('../lib/index')
const testConfig = require('./fixtures/flag-config.json')
const localTestConfig = require('./fixtures/local-config.json')

describe('FeatureFlagClient unit tests', function() {
  let client,
      clientB,
      userId = '123'
  const config = testConfig

  const context = {
    userId: userId,
    configUrl: 'testurl',
    Platform: ["iOS"],
    Brand: ["BrandA"],
    configRefreshInterval: 300000
  }

  const contextB = {
    userId: userId,
    configUrl: 'testurl',
    Platform: ["Windows"],
    Brand: ["BrandB"],
  }

  const contextNoConfigUrl = {
    userId: '123'
  }

  before(async function() {
    client = new FeatureFlagClient(context)
    clientB = new FeatureFlagClient(contextB)
    clientLocalConfig = new FeatureFlagClient(context, localTestConfig)
    const loadConfigFake = async () => Promise.resolve({'data': testConfig})
    sandbox.stub(client, 'loadConfig').callsFake(loadConfigFake)
    sandbox.stub(clientB, 'loadConfig').callsFake(loadConfigFake)
    sandbox.stub(clientLocalConfig, 'loadConfig').callsFake(loadConfigFake)
  })

  after(async function() {
    sandbox.restore()
  })

  describe('initialization tests', function() {
    it('should throw an error when the context object is not passed', function() {
      const initNoArgs = () => new FeatureFlagClient()
      expect(initNoArgs).to.throw('Please provide a context object to the constructor.')
    })

    it('should throw an error when neither a configUrl nor a config object is not passed', function() {
      const initNoConfigUrl = () => new FeatureFlagClient(contextNoConfigUrl)
      expect(initNoConfigUrl).to.throw('Please provide either a config url or a valid config file.')
    })

    it('should not throw an error if either configUrl or config arguments are passed', function() {
      expect(() => new FeatureFlagClient(context)).to.not.throw()
      expect(() => new FeatureFlagClient(context, config)).to.not.throw()
    })

    it('should check that a new instance of FeatureFlagClient contains the required properties after initialization', function() {
       expect(client).to.have.property('context')
       expect(client).to.have.property('config')
       expect(client).to.have.property('initialized')
       expect(client).to.have.property('featureFlagUserId')
       expect(client).to.have.property('configCacheStart')
       expect(client).to.have.property('configRefreshIntervalDefault')
       expect(client).to.have.property('storage')
       expect(client.initialized).to.equal(false)
    })
  })

  describe('userId creation tests', async function () {
    it('should create and return a new ffUserId when the config file specifies ffUserId', async function () {
      const response = await client.queryFeatureFlag('feature-A')
      assert.exists(response.userId)
      expect(response.userId).to.equal(userId)
      expect(response.userIdType).to.equal('appUserId')
    })
  })

  describe('feature flag querying tests', async function () {
    it('should succesfully query for "feature-A"', async function () {
      const response = await client.queryFeatureFlag('feature-A')
      expect(response.enabled).to.equal(true)
      expect(response.featureName).to.equal('feature-A')
      expect(response.userId).to.equal(userId)
      expect(response.userIdType).to.equal('appUserId')
    })

    it('should not match any target criteria and fall through to default for "feature-A"', async function () {
      const response = await clientB.queryFeatureFlag('feature-A')
      expect(response.enabled).to.equal(false)
      expect(response.featureName).to.equal('feature-A')
      expect(response.userId).to.equal(userId)
      expect(response.userIdType).to.equal('appUserId')
    })

    it('should succesfully query for "feature-B" (appUserId)', async function () {
      const response = await client.queryFeatureFlag('feature-B')
      expect(response.enabled).to.equal(false)
      expect(response.featureName).to.equal('feature-B')
      expect(response.userId).to.equal(userId)
      expect(response.userIdType).to.equal('appUserId')
    })

    it('should succesfully query for "feature-B" (ffUserId)', async function () {
      const response = await clientB.queryFeatureFlag('feature-B')
      expect(response.enabled).to.equal(false)
      expect(response.featureName).to.equal('feature-B')
      expect(response.userId).to.equal(userId)
      expect(response.userIdType).to.equal('appUserId')
    })

    it('should succesfully query for all features', async function() {
      const response = await client.queryAllFeatureFlags()
      expect(response).to.have.lengthOf.at.least(2)
      expect(response[0]).to.have.property('enabled')
      assert.isBoolean(response[0].enabled)
      expect(response[0]).to.have.property('featureName')
      expect(response[0]).to.have.property('userId')
      expect(response[0].userId).to.equal(userId)
    })

    it('should query from local config file when provided', async function() {
      const responseA = await clientLocalConfig.queryFeatureFlag('feature-A')
      expect(responseA.enabled).to.equal(true)
      expect(responseA.featureName).to.equal('feature-A')
      expect(responseA.userId).to.equal(userId)

      const responseB = await clientLocalConfig.queryFeatureFlag('feature-B')
      expect(responseB.enabled).to.equal(false)
      expect(responseB.featureName).to.equal('feature-B')
      expect(responseB.userId).to.equal(userId)
    })

  })

  describe('feature flag config cache expiration interval tests', function () {
    it('should should that the config cache is expired', async function() {
      const interval = 0
      const isCacheExpired = client.checkConfigCacheExpiry(interval)
      expect(isCacheExpired).to.equal(true)
    })

    it('should should that the config cache is not expired', async function() {
      const interval = 3600
      const isCacheExpired = client.checkConfigCacheExpiry(interval)
      expect(isCacheExpired).to.equal(false)
    })
  })

})