import { type Locator, type Page } from '@playwright/test'
import { CalendarPage } from '../calendar-page'
import { NewDocument } from '../types'
export class DocumentsPage extends CalendarPage {
  readonly page: Page
  readonly buttonCreateDocument: Locator
  readonly buttonPopupNextStep: Locator
  readonly buttonSpaceSelector: Locator
  readonly buttonParentSelector: Locator
  readonly inputNewDocumentTitle: Locator
  readonly inputNewDocumentDescription: Locator
  readonly inputNewDocumentCreateDaft: Locator

  constructor (page: Page) {
    super(page)
    this.page = page
    this.buttonCreateDocument = page.locator(
      'div[data-float="navigator"] button[type="submit"]:not([class*="only-icon"])'
    )
    this.buttonPopupNextStep = page.locator('div.popup button[type="submit"]')
    this.buttonSpaceSelector = page.locator('button[id="space.selector"]')
    this.buttonParentSelector = page.locator('div.parentSelector span[class*="label"]')
    this.inputNewDocumentTitle = page.locator('div[id="doc-title"] input')
    this.inputNewDocumentDescription = page.locator('div[id="doc-description"] input')
    this.inputNewDocumentCreateDaft = page.locator('div.footer div.footerButtons button[type="button"]')
  }

  async createDocument (data: NewDocument, startSecondStep: boolean = false): Promise<void> {
    if (data.location != null) {
      await this.buttonSpaceSelector.click()
      await this.selectListItemWithSearch(this.page, data.location.space ?? '')

      await this.page.locator('div.parentSelector span[class*="label"]', { hasText: data.location.parent }).click()
    }

    // template
    if (!startSecondStep) {
      await this.buttonPopupNextStep.click()
    }
    await this.page.locator('div.templates div.tmpHeader', { hasText: data.template }).click()

    // title
    await this.buttonPopupNextStep.click()
    await this.inputNewDocumentTitle.fill(data.title)
    await this.inputNewDocumentDescription.fill(data.description)

    if (data.reason != null) {
      await this.page.locator('div.radio label', { hasText: data.reason }).click()
    }

    // team
    await this.buttonPopupNextStep.click()

    await this.inputNewDocumentCreateDaft.click()
  }

  async openDocument (name: string): Promise<void> {
    await this.page.locator('button.hulyNavItem-container > span[class*="label"]', { hasText: name }).click()
  }

  async executeMoreActionsOnDocument (documentName: string, action: string): Promise<void> {
    await this.page.locator('button.hulyNavItem-container > span[class*="label"]', { hasText: documentName }).hover()
    await this.page
      .locator('button.hulyNavItem-container > span[class*="label"]', { hasText: documentName })
      .locator('xpath=..')
      .locator('div[class*="actions"]:not([class*="arrow"])')
      .click()
    await this.selectFromDropdown(this.page, action)
  }
}
