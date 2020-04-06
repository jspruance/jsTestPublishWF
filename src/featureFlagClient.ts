/**
 * @module wm-feature-flag-client
 */
/**
 * Copyright (c) Warner Media. All rights reserved.
 */
import axios from 'axios'
import crypto from 'crypto'
import { v4 as uuidv4 } from 'uuid'
import * as winston from 'winston'
import { IConfig, IContext, IFeatureFlagClient, IFlag, ILoadConfigResponse, IQueryFeatureResult, ITargetingConfig } from './interfaces'
import { FeatureFlagStorage } from './featureFlagStorage'
import { APP_USER_ID, FEATURE_FLAG_CONFIG, FEATURE_FLAG_USER_ID, FEATURE_FLAG_CONFIG_ETAG } from './config/constants'
const logger = winston.createLogger({
  transports: [new winston.transports.Console()],
})

/**
 * Provides core feature flag querying functionality for
 * determining which features are enabled for a specific user.
 * @implements {IFlagFlagClient}
 */
export class FeatureFlagClient implements IFeatureFlagClient {
  private context: IContext
  private config?: IConfig
  private featureFlagUserId: string
  private initialized: boolean
  private configCacheStart: Date
  private configRefreshIntervalDefault: number
  private storage: FeatureFlagStorage
  /**
   * Creates a new instance of the [FeatureFlagClient] class.
   * @param context The conext object containing the userId and config data
   * @param config Optional. The feature flag config file.
   *
   * @remarks
   * If the context.userId property is not provided, one will be generated and returned to the client.
   * The config file at location context.configUrl will be fetched from AWS S3 unless a config file is provided
   */
  constructor(context: IContext, config?: IConfig) {
    if (!context) throw new Error('Please provide a context object to the constructor.')
    if (!context.configUrl && !config) throw new Error('Please provide either a config url or a valid config file.')
    this.context = context
    this.config = config
    this.initialized = false
    this.featureFlagUserId = ''
    this.configCacheStart = new Date()
    this.configRefreshIntervalDefault = 86400000
    const storageType = context && context.storageType ? context.storageType : ''
    this.storage = new FeatureFlagStorage(storageType)
  }

  /**
   * Creates a hash of the userId and saltKey
   * @param userId The userId used to create the hash
   * @param salt The salt used to create the hash
   * @return {string} hash
   */
  private createHash(userId: string, salt: string): string {
    const hash = crypto.createHmac('sha256', salt)
    hash.update(userId)
    const hashValue = hash.digest('hex')
    return hashValue
  }

  /**
   * Creates a user id
   * @return {string} userId
   */
  private createUserId(): string {
    const userId = uuidv4()
    return userId
  }

  /**
   * Creates a 2-digit string from the hash to be used as an index for
   * comparing against the rollout percentage of the feature to determine
   * whether the feature is enabled or disabled
   * @param hash
   * @return {string} 2-digit segment of the hash
   */
  private getUserFeatureIndex(hash: string): string {
    const hashSegment = parseInt(hash.slice(-2), 16)
    return hashSegment.toString().slice(-2)
  }

  /**
   * Initialization code to ensure that the userId and config are set
   * @return {void}
   */
  private async init(): Promise<void> {
    const { config, initialized, featureFlagUserId, storage, configRefreshIntervalDefault } = this
    const { configUrl, userId, configRefreshInterval } = this.context
    // get user-defined refresh interval or use default if none provided
    const cfgRefreshInterval = configRefreshInterval ? configRefreshInterval : configRefreshIntervalDefault
    const cacheIsExpired = this.checkConfigCacheExpiry(cfgRefreshInterval)

    // initialization steps:
    // 1. ensure we have feature flag configuration. if none provided in context object,
    //    look for config in storage, otherwise fetch it from configUrl location
    if (!config || cacheIsExpired) {
      try {
        if (!configUrl) throw new Error('Failed to load config file - no config url provided.')
        const configFromStorage = storage.get(FEATURE_FLAG_CONFIG)
        if (configFromStorage) this.config = JSON.parse(configFromStorage)
        if (!configFromStorage || cacheIsExpired) {
          // check if config file has changed before downloading
          // by populating 'If-None-Match' header with value of the previous etag
          // get config file (if it has been updated), save it in storage along with new eTag
          const prevETag = storage.get(FEATURE_FLAG_CONFIG_ETAG) || '-1'
          const response = await this.loadConfig(configUrl, prevETag)
          this.config = response.data ? response.data : this.config
          const eTag = (response.headers && response.headers.etag) ? response.headers.etag : ''
          if (eTag) storage.set(FEATURE_FLAG_CONFIG_ETAG, eTag)
          storage.set(FEATURE_FLAG_CONFIG, JSON.stringify(this.config))
        }
      } catch (err) {
        logger.error(err)
      }
    }

    // pass through if instance already initialized
    if (initialized) return

    // 2. ensure we have a userId. if it's not in the context object, check storage.
    if (!userId) {
      const userId = storage.get(APP_USER_ID)
      if (userId) this.context.userId = userId
    } else {
      storage.set(APP_USER_ID, userId)
    }

    // 3. ensure we have a featureFlagUserId. if there isn't one in storage, create one.
    if (!featureFlagUserId) {
      const ffUserId = storage.get(FEATURE_FLAG_USER_ID)
      if (!ffUserId) {
        this.featureFlagUserId = this.createUserId()
        storage.set(FEATURE_FLAG_USER_ID, this.featureFlagUserId)
      }
    }

    this.initialized = true
  }

  /**
   * Determine whether the flag config has been cached longer than the desired interval
   * @param interval The maximum time (in ms) to cache the config file before fetching a new copy
   * @return {boolean}
   */
  checkConfigCacheExpiry(interval: number): boolean {
    const { configCacheStart } = this
    const now = new Date()
    const cacheTimeElapsed = (now.getTime() - configCacheStart.getTime()) // in ms
    const expired = (cacheTimeElapsed > interval) ? true : false
    return expired
  }

  /**
   * Loads the config file from the configUrl location
   * @param configUrl Uri for the desired feature flag config file
   * @param eTag The value of the etag header from the previous request, default to -1
  */
  async loadConfig(configUrl: string, eTag = '-1'): Promise<ILoadConfigResponse> {
    let response
    const headers = { 'If-None-Match': eTag }
    try {
      response = await axios.get(configUrl, { headers })
    } catch (error) {
      throw new Error('Failed to retrieve config file.')
    }
    return response
  }

  /**
   * Determine which targeting configuration from the feature config file to use
   * @param context The conext object containing the userId and config data
   * @param targetingConfigs targeting configuration objects from the feature config file
   * @return {ITargetingConfig}
   */
  getTargetingConfig(context: IContext, targetingConfigs: ITargetingConfig[]): ITargetingConfig {
    // set a defaut targeting config in case no matches found
    let targetingConfig: ITargetingConfig = { rolloutValue: '0', targetPriority: 1 }

    // sort by 'targetPriority' property
    const targetConfigsSorted = [...targetingConfigs]
    targetConfigsSorted.sort((a, b) => (a.targetPriority > b.targetPriority ? 1 : -1))

    // identify targeting config to use by validating all 'targetCriteria' fields
    const matchedTargetingConfig = targetConfigsSorted.find(targetConfig => {
      let matchDetected = false
      if (!targetConfig.targetCriteria) return
      const targetFields = targetConfig.targetCriteria
      // iterate through target criteria
      for (let i = 0; i < targetFields.length; i++) {
        const { targetFieldName, targetFieldValues } = targetFields[i]
        // return early if there's no targeting info
        if (!targetFieldName || !targetFieldValues || !context[targetFieldName]) return
        // if at least one target field value is present in context object, consider the filed validated
        const targetFieldFoundInContext = targetFieldValues.some((fieldValue: string) => {
          // check for both string and array values of the matching property
          if (typeof context[targetFieldName] === 'string') return context[targetFieldName] === fieldValue
          if (Array.isArray(context[targetFieldName])) {
            return context[targetFieldName].some((contextValue: string) => contextValue === fieldValue)
          }
        })
        matchDetected = targetFieldFoundInContext
        if (!matchDetected) break
      }
      return matchDetected
    })

    // overwrite default targeting config if a matching config was found
    if (matchedTargetingConfig) targetingConfig = { ...matchedTargetingConfig }
    return targetingConfig
  }

  /**
   * Checks whether or not a given feature is enabled for a specific user
   * @param featureName
   * @return {IQueryFeatureResult} response object containing feature name, 'enabled' boolean and userId
   */
  async queryFeatureFlag(featureName: string): Promise<IQueryFeatureResult> {
    const { context, storage } = this
    let enabled = false,
      flagConfig: any = [],
      hashId,
      operationalId,
      userFeatureIndex: string,
      userIdType = 'appUserId'
    try {
      await this.init()
      operationalId = this.context.userId
      if (!this.config || !this.config.flags)
        throw new Error('Operation failed - no config file or invalid config file detected.')

      // get the feature flag configuration matching the feature name provided
      flagConfig = this.config.flags.find((flag: IFlag) => flag.flagName === featureName)
      const { targeting } = flagConfig

      // determine the feature's targeting config
      const targetingConfig = this.getTargetingConfig(context, targeting)
      let { rolloutValue } = targetingConfig
      const { stickinessProperty } = targetingConfig
      rolloutValue = rolloutValue || '0'

      // create the hash and 'user feature index' (derived from hash)
      const saltKey = flagConfig.flagId
      hashId = this.context.userId
      if (stickinessProperty === 'ffUserId') {
        let ffUserId = storage.get(FEATURE_FLAG_USER_ID)
        if (!ffUserId) {
          ffUserId = this.createUserId()
          storage.set(FEATURE_FLAG_USER_ID, ffUserId)
        }
        operationalId = this.featureFlagUserId
        userIdType = 'ffUserId'
        hashId = ffUserId
      }
      if (!hashId) throw new Error('Operation failed - userId not provided')
      const hash = this.createHash(hashId, saltKey)
      userFeatureIndex = this.getUserFeatureIndex(hash)

      // determine whether or not flag is enabled for the given user
      enabled = parseInt(userFeatureIndex, 10) < parseInt(rolloutValue, 10) ? true : false
    } catch (err) {
      logger.error(err)
    }

    return {
      featureName: featureName,
      enabled: enabled,
      userId: operationalId,
      userIdType: userIdType,
    }
  }

  /**
   * Checks availability of all features for a specific user
   * @return {IQueryFeatureResult[]} array of feature flag data objects
   */
  async queryAllFeatureFlags(): Promise<IQueryFeatureResult[]> {
    await this.init()
    const { config } = this
    if (!config || !config.flags) throw new Error('No config file or invalid config file detected.')
    const featureFlagResultsMap: IQueryFeatureResult[] = []
    const promises = config.flags.map(async (flag: IFlag) => {
      const featureFlagData: IQueryFeatureResult = await this.queryFeatureFlag(flag.flagName)
      featureFlagResultsMap.push(featureFlagData)
    })
    return Promise.all(promises).then(() => featureFlagResultsMap)
  }
}
