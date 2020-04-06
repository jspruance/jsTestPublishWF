/**
 * @module wm-feature-flag-client
 */
/**
 * Copyright (c) Warner Media. All rights reserved.
 */
import { IStorage } from './interfaces'

export class FeatureFlagStorage implements IStorage {
  private storageType: string
  private storage: any

  constructor(storageType: string) {
    this.storageType = storageType
    switch (this.storageType) {
      case 'localStorage':
        this.storage = localStorage
        break
      case 'sessionStorage':
        this.storage = sessionStorage
        break
      case 'inMemory': // todo: implement an in-memory storage option for non-browser env
      default:
        this.storage = typeof Storage !== 'undefined' ? localStorage : {}
    }
  }

  get(key: string): string | void {
    if (typeof Storage === 'undefined') return
    const storeItem = this.storage.getItem(key)
    return storeItem
  }

  set(key: string, value: string): void {
    if (typeof Storage === 'undefined') return
    this.storage.setItem(key, value)
    return
  }

  delete(key: string): void {
    if (typeof Storage === 'undefined') return
    this.storage.deleteItem(key)
    return
  }
}
