export interface IConfig {
  featureFlagLibraryVersion?: string;
  flags: IFlag[];
}

export interface IContext {
  userId: string;
  configUrl?: string;
  [key: string]: any;
}

export interface IFeatureFlagClient {
  queryFeatureFlag(featureName: string): any;
  queryAllFeatureFlags(): any;
}

export interface IFlag {
  flagName: string;
  flagId: string;
  flagType: string;
  targeting: any[];
}

export interface ILoadConfigResponse {
  headers: any;
  data: IConfig;
}

export interface IQueryFeatureResult {
  featureName: string;
  enabled: boolean;
  userId: string | undefined;
  userIdType: string;
}

export interface IStorage {
  set(key: string, value: any): any;
  get(key: string): any;
  delete(key: string): void;
}

export interface ITargetingConfig {
  targetPriority: number;
  rolloutValue: string;
  stickinessProperty?: string;
  targetCriteria?: any[];
}

export interface ITargetField {
  targetFieldName: string;
  targetFieldValues: string[];
}