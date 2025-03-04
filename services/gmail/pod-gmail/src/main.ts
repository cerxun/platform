//
// Copyright © 2020, 2021 Anticrm Platform Contributors.
// Copyright © 2021 Hardcore Engineering Inc.
//
// Licensed under the Eclipse Public License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License. You may
// obtain a copy of the License at https://www.eclipse.org/legal/epl-2.0
//
// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an "AS IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
//
// See the License for the specific language governing permissions and
// limitations under the License.
//

import { setMetadata } from '@hcengineering/platform'
import serverClient from '@hcengineering/server-client'
import { type IncomingHttpHeaders } from 'http'
import { decode64 } from './base64'
import config from './config'
import { GmailController } from './gmailController'
import { decode } from './jwt'
import { createServer, listen } from './server'
import { closeDB, getDB } from './storage'
import { type Endpoint, type State } from './types'

const extractToken = (header: IncomingHttpHeaders): any => {
  try {
    return header.authorization?.slice(7) ?? ''
  } catch {
    return undefined
  }
}

export const main = async (): Promise<void> => {
  setMetadata(serverClient.metadata.Endpoint, config.AccountsURL)
  setMetadata(serverClient.metadata.UserAgent, config.ServiceID)
  const db = await getDB()
  const gmailController = GmailController.getGmailController(db)
  await gmailController.startAll()
  const endpoints: Endpoint[] = [
    {
      endpoint: '/signin',
      type: 'get',
      handler: async (req, res) => {
        try {
          const token = extractToken(req.headers)

          if (token === undefined) {
            res.status(401).send()
            return
          }
          const redirectURL = req.query.redirectURL as string

          const { email, workspace } = decode(token)
          const gmail = await gmailController.getGmailClient(email, workspace, token)
          const url = gmail.getAutUrl(redirectURL)
          res.send(url)
        } catch (err) {
          console.log('signin error', JSON.stringify(err))
          res.status(500).send()
        }
      }
    },
    {
      endpoint: '/signin/code',
      type: 'get',
      handler: async (req, res) => {
        const code = req.query.code as string
        const state = JSON.parse(decode64(req.query.state as string)) as unknown as State
        const gmail = await gmailController.createClient(state)
        await gmail.authorize(code)
        res.redirect(state.redirectURL)
      }
    },
    {
      endpoint: '/signout',
      type: 'get',
      handler: async (req, res) => {
        try {
          const token = extractToken(req.headers)

          if (token === undefined) {
            res.status(401).send()
            return
          }

          const { email, workspace } = decode(token)
          await gmailController.signout(workspace, email)
        } catch (err) {
          console.log('signout error', JSON.stringify(err))
        }

        res.send()
      }
    },
    {
      endpoint: '/push',
      type: 'post',
      handler: async (req, res) => {
        const data = req.body?.message?.data
        if (data === undefined) {
          res.status(400).send({ err: "'data' is missing" })
          return
        }
        gmailController.push(data)

        res.send()
      }
    }
  ]

  const server = listen(createServer(endpoints), config.Port)

  const shutdown = (): void => {
    server.close(() => {
      void gmailController
        .close()
        .then(async () => {
          await closeDB()
        })
        .then(() => process.exit())
    })
  }

  process.on('SIGINT', shutdown)
  process.on('SIGTERM', shutdown)
  process.on('uncaughtException', (e) => {
    console.error(e)
  })
  process.on('unhandledRejection', (e) => {
    console.error(e)
  })
}
