//
// Copyright © 2023 Hardcore Engineering Inc
//

// Add this to the VERY top of the first file loaded in your app
import { Analytics } from '@hcengineering/analytics'
import contactPlugin from '@hcengineering/contact'
import { MeasureMetricsContext, newMetrics } from '@hcengineering/core'
import notification from '@hcengineering/notification'
import { setMetadata } from '@hcengineering/platform'
import { getMetricsContext, serverConfigFromEnv } from '@hcengineering/server'
import { storageConfigFromEnv } from '@hcengineering/server-storage'
import serverCore, { type StorageConfiguration, loadBrandingMap } from '@hcengineering/server-core'
import serverNotification from '@hcengineering/server-notification'
import serverToken from '@hcengineering/server-token'
import { serverFactories } from '@hcengineering/server-ws/src/factories'
import { SplitLogger, configureAnalytics } from '@hcengineering/analytics-service'
import { join } from 'path'
import { start } from '.'
const serverFactory = serverFactories[(process.env.SERVER_PROVIDER as string) ?? 'ws'] ?? serverFactories.ws

configureAnalytics(process.env.SENTRY_DSN, {})
Analytics.setTag('application', 'transactor')

// Force create server metrics context with proper logging
getMetricsContext(
  () =>
    new MeasureMetricsContext(
      'server',
      {},
      {},
      newMetrics(),
      new SplitLogger('server', {
        root: join(process.cwd(), 'logs'),
        enableConsole: (process.env.ENABLE_CONSOLE ?? 'true') === 'true'
      })
    )
)

const config = serverConfigFromEnv()
const storageConfig: StorageConfiguration = storageConfigFromEnv()

const lastNameFirst = process.env.LAST_NAME_FIRST === 'true'
setMetadata(contactPlugin.metadata.LastNameFirst, lastNameFirst)
setMetadata(serverCore.metadata.FrontUrl, config.frontUrl)
setMetadata(serverCore.metadata.UploadURL, config.uploadUrl)
setMetadata(serverToken.metadata.Secret, config.serverSecret)
setMetadata(serverNotification.metadata.SesUrl, config.sesUrl ?? '')
setMetadata(notification.metadata.PushPublicKey, config.pushPublicKey)
setMetadata(serverNotification.metadata.PushPrivateKey, config.pushPrivateKey)
setMetadata(serverNotification.metadata.PushSubject, config.pushSubject)
setMetadata(serverCore.metadata.ElasticIndexName, config.elasticIndexName)

const shutdown = start(config.url, {
  fullTextUrl: config.elasticUrl,
  storageConfig,
  rekoniUrl: config.rekoniUrl,
  port: config.serverPort,
  serverFactory,
  indexParallel: 2,
  indexProcessing: 500,
  productId: '',
  brandingMap: loadBrandingMap(config.brandingPath),
  accountsUrl: config.accountsUrl,
  enableCompression: config.enableCompression
})

const close = (): void => {
  console.trace('Exiting from server')
  console.log('Shutdown request accepted')
  void shutdown().then(() => {
    process.exit(0)
  })
}

process.on('unhandledRejection', (reason, promise) => {
  console.log('Unhandled Rejection at:', promise, 'reason:', reason)
})

process.on('SIGINT', close)
process.on('SIGTERM', close)
