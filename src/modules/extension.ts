import { deepExtendHtmlTerminated } from './extend'
import { styleClass } from './constants'
import {
  generateExplorerFolderElements,
  getExplorerContainerElement,
  getExplorerHeaderElement,
  getExplorerItemElementWithName,
  getFilesContainerElement,
  addEachFileToContainer,
  prepareEmptyDiffViewerElement,
  setupPageStructure,
  getExplorerFilterElementWithName, getLoadingElement
} from './dom'
import {
  extractPathDataFromElements,
  DecoratedFileElement,
  MappedFileElement,
  ExplorerDataMap,
  FilePathFilter
} from './structure'
import { getReversedPathFragments, isValidHrefPath, checkIfValidAnchor, checkIfHashContainsAnchor } from './paths'
import { onContentReady, onFilesLoaded, onLocationCheck } from './handlers'
import { Logger } from './logger'

/**
 * The root class which handles extension state management
 * and construction of the file explorer.
 */
export class Extension {
  private _fileEls: HTMLElement[] = []
  private _mappedFileEls: MappedFileElement[] = []
  private _loadingEl: HTMLElement | null
  private _activeFileEl: HTMLElement | null
  private _activeExplorerFileEl: HTMLElement | null

  private _selectedFilePaths: Set<string>
  private _filters: FilePathFilter[]
  private _selectedFilters: Set<string>

  private _isExplorerParsing: boolean
  private _explorerData: ExplorerDataMap
  private _currentHref: string

  public constructor() {  
    this._loadingEl = null
    this._activeFileEl = null
    this._activeExplorerFileEl = null

    this._selectedFilePaths = new Set()
    this._filters = []
    this._selectedFilters = new Set()
    
    this._isExplorerParsing = false
    this._explorerData = {}
    this._currentHref = window.location.href
  }

  get files(): HTMLElement[] {
    return this._fileEls
  }

  get mappedFiles(): MappedFileElement[] {
    return this._mappedFileEls
  }

  get activeFile(): HTMLElement | null {
    return this._activeFileEl
  }

  get activeExplorerFile(): HTMLElement | null {
    return this._activeExplorerFileEl
  }

  /**
   * Initialization entry of the extension. Monitors for a valid path
   * and when one is found it prepares the content to be loaded. It also
   * ensures the required DOM is fully loaded, containing all of the
   * diffs.
   */
  public init(): void {
    if (isValidHrefPath(this._currentHref)) {
      onContentReady()
        .then(() => this.handleContentReady())

      // Listen for future location changes and update content accordingly
      setTimeout(() => {
        onLocationCheck(this._currentHref)
          .then(nextHref => this.handleLocationChanged(nextHref))
      }, 3000)
    } else {
      // TODO: Refactor to a view manager which ensures no timeouts are repeated
      onLocationCheck(this._currentHref)
        .then(nextHref => this.handleLocationChanged(nextHref))
    }
  }

  /**
   * Location update handler which is triggered when a user navigates
   * back to a valid pull request diff viewer page.
   */
  handleLocationChanged(nextHref: string): void {
    this._currentHref = nextHref

    // this.cleanup_LoadingEl();

    // TODO: Check if active location is correct, if navigating away then reset
    // explorer and prepare a re-render on return

    // TODO: Better reset logic in general, provide external reset handlers to
    // test toggling the explorer on and off

    if (!this._isExplorerParsing) {
      Logger.log('[handleLocationChanged] Location changed, setting content ready')
      onContentReady().then(() => this.handleContentReady())
    }
  }

  /**
   * The DOM is fully loaded and ready to be processed
   */
  handleContentReady(): void {
    this._isExplorerParsing = true

    this._loadingEl = getLoadingElement()
    document.querySelector('body')?.appendChild(this._loadingEl)

    onFilesLoaded()
      .then(files => this.handleFilesLoaded(files))
      .then(() => this.cleanupLoadingEl())
      .catch(error => {
        Logger.error(error)
      })
  }

  /**
   * All diffs have loaded and the explorer can now be constructed
   * @param _fileEls
   */
  handleFilesLoaded(_fileEls: HTMLElement[]): void {
    this._fileEls = _fileEls

    setupPageStructure()
    this.buildFileExplorer()
  }

  /**
   * Processes the current diff structure and creates a file explorer
   * from the content.
   */
  buildFileExplorer(): void {
    this.parseFileExplorerData()
    this.constructFilters()

    // The explorer element is the file explorer located
    // to the left of the viewer.
    const explorerContainerEl = getExplorerContainerElement()
    const explorerHeaderEl = getExplorerHeaderElement(explorerContainerEl)
    const nestedFolderEl = generateExplorerFolderElements(this._explorerData)

    const nestedFolderElContainer = document.createElement('div')
    nestedFolderElContainer.classList.add(styleClass.explorerFolderTopContainer)
    nestedFolderElContainer.appendChild(nestedFolderEl)

    const filterElContainer = document.createElement('div')
    filterElContainer.classList.add(styleClass.explorerFilterTopContainer)

    this._filters.forEach((filter) => {
      const filterEl = document.createElement('ul')
      filterEl.classList.add(styleClass.explorerFilterContainer)
      filterEl.appendChild(filter.explorerFilterEl)
      filterElContainer.appendChild(filterEl)
    })

    explorerContainerEl.appendChild(explorerHeaderEl)
    explorerContainerEl.appendChild(filterElContainer)
    explorerContainerEl.appendChild(nestedFolderElContainer)

    // The diff viewer is the container which has both the file
    // explorer and the file diffs.
    const diffViewerEl = prepareEmptyDiffViewerElement()

    // The files container element is the newly created container
    // which hosts the parsed file diffs. We keep the old container
    // around in case there is any JavaScript on the GitHub side
    // which still targets it.
    const filesContainerEl = getFilesContainerElement()
    addEachFileToContainer(this._fileEls, filesContainerEl)

    Logger.log('[buildFileExplorer] Explorer container prepared: ', explorerContainerEl)
    Logger.log('[buildFileExplorer] Files container prepared: ', filesContainerEl)
    Logger.log('[buildFileExplorer] Appending files to viewer wrapper: ', diffViewerEl)

    diffViewerEl.appendChild(explorerContainerEl)
    diffViewerEl.appendChild(filesContainerEl)

    setTimeout(() => {
      Logger.log('[buildFileExplorer] File explorer is complete: ', diffViewerEl)
      this._isExplorerParsing = false
      this.selectDefaultFilters()
      this.updateSelectedFilesBasedOnFilters()
      this.updateActiveFileElements()

      // clearTimeout(loadingTimeout);
      // this.cleanup_LoadingEl();
    }, 0)
  }

  parseFileExplorerData(): void {
    const decoratedFileEls = extractPathDataFromElements(this._fileEls)
    Logger.log('[parseFileExplorerData] Decorated file elements: ', decoratedFileEls)

    const mappedFileEls = this.addDecoratedFileEventListeners(decoratedFileEls)
    this._mappedFileEls = mappedFileEls
    Logger.log('[parseFileExplorerData] Mapped file elements: ', mappedFileEls)

    // Here we're going to iterate through the path and nest
    // the mapped file at the same place where it's nested
    // according to the path. This allows us to construct an
    // explorer object which looks very similar to the explorer
    // we're building
    const nestedPathData = mappedFileEls.map(mappedEl => {
      return getReversedPathFragments(mappedEl.path).reduce<ExplorerDataMap>(
        (acc, path) => ({ [path]: acc }),

        // Forcefully setting as any here, as we're just using this as a
        // convenience operation to inject the mapped element at the root
        // of this tree
        mappedEl as any
      )
    }) 
      
    this._explorerData = deepExtendHtmlTerminated({}, ...nestedPathData)
    Logger.log('[parseFileExplorerData] Path data nested as object: ', mappedFileEls)
  }

  constructFilters(): void {
    const nonZzzFilter: FilePathFilter = {
      explorerFilterEl: getExplorerFilterElementWithName("Non-ZZZ Files"),
      name: "Non-ZZZ Files",
      contains(path: string): boolean {
        return !path.includes("zzz")
      }
    }
    const zzzFilter: FilePathFilter = {
      explorerFilterEl: getExplorerFilterElementWithName("ZZZ Files"),
      name: "ZZZ Files",
      contains(path: string): boolean {
        return path.includes("zzz")
      }
    }
    this._filters = [
        nonZzzFilter,
        zzzFilter
    ]

    this._filters.forEach((filter) => {
      filter.explorerFilterEl.addEventListener('click', () => {
        this.toggleFilter(filter)
        this.updateActiveFileElements()
      })
    })
    Logger.log('[constructFilters] Filters constructed: ', this._filters)
  }

  addDecoratedFileEventListeners(files: DecoratedFileElement[]): MappedFileElement[] {
    return files.map<MappedFileElement>((file, index) => {
      const filePathFragments = getReversedPathFragments(file.path)
      const fileName = filePathFragments[0]

      const mappedFile: MappedFileElement = {
        name: fileName,
        path: file.path,
        anchor: file.anchor,
        isViewed: false,
        rootFileEl: file.el,
        rootFileHeaderEl: file.el.children[0] as HTMLElement,
        explorerFileEl: getExplorerItemElementWithName(fileName)
      }

      // Set first pass data for viewed file element
      mappedFile.isViewed = this.isViewedFile(mappedFile.rootFileHeaderEl)
      this.updateViewedFileStatus(mappedFile)

      // Set listener for future viewed file changes
      mappedFile.rootFileHeaderEl.addEventListener('click', (event: Event) => {
        const target = event.target as (HTMLElement | null)
        if (target?.classList.contains('js-reviewed-checkbox')) {

          // Pre-emptive update to ensure we switch the state from whatever
          // it was previously
          mappedFile.isViewed = !mappedFile.isViewed
          this.updateViewedFileStatus(mappedFile)

          setTimeout(() => {
            // Follow up with a check to ensure the state is correct
            mappedFile.isViewed = this.isViewedFile(mappedFile.rootFileHeaderEl)
            this.updateViewedFileStatus(mappedFile)
          }, 500)
        }
      })

      // Set first pass data for active file
      const isValidAnchor = checkIfValidAnchor() // Link contains which file to view.

      // TODO: Ensure returning to correctly deep linked elements, as this doesn't
      // always work in the current format
      if (!isValidAnchor && index === 0) {
        this.setActiveFile(mappedFile)
      } else if (isValidAnchor) {
        const hashContainsAnchor = checkIfHashContainsAnchor(file.anchor)

        if (hashContainsAnchor) {
          this.setActiveFile(mappedFile)
        }
      }

      // Set listener for future active file changes
      mappedFile.explorerFileEl.addEventListener('click', () => {
        // this.clearActiveFile()
        // this.setActiveFile(mappedFile)
        this.toggleActiveFile(mappedFile)
        this.updateActiveFileElements()
      })

      return mappedFile
    })
  }

  toggleActiveFile(file: MappedFileElement): void {
    if (this._selectedFilePaths.has(file.path)) {
      this._selectedFilePaths.delete(file.path)
    } else {
      this._selectedFilePaths.add(file.path)
    }
  }

  setActiveFile(file: MappedFileElement): void {
    this._selectedFilters.clear()
    this._selectedFilePaths.clear()
    this._selectedFilePaths.add(file.path)
  }

  toggleFilter(filter: FilePathFilter): void {
    Logger.log("FILTER SELECTED", filter)
    if (this._selectedFilters.has(filter.name)) {
      this._selectedFilters.delete(filter.name)
    } else {
      this._selectedFilters.add(filter.name)
    }
    this.updateSelectedFilesBasedOnFilters()
  }

  selectDefaultFilters(): void {
    const nonYamlFilter = this._filters.find((filter) => filter.name == "Non-ZZZ Files")
    if (nonYamlFilter) {
      this._selectedFilters.add(nonYamlFilter.name)
    }
  }

  updateSelectedFilesBasedOnFilters(): void {
    const appliedFilters = this._filters.filter((filter) => {
      return this._selectedFilters.has(filter.name)
    })

    this._mappedFileEls.forEach((fileEl) => {
      const shouldDisplay = appliedFilters.some((filter) => {
        return filter.contains(fileEl.path)
      })
      if (shouldDisplay) {
        this._selectedFilePaths.add(fileEl.path)
      } else {
        this._selectedFilePaths.delete(fileEl.path)
      }
    })
  }

  selectFileEl(fileEl: MappedFileElement): void {
    if (!fileEl.rootFileEl.classList.contains(styleClass.activeFile)) {
      fileEl.rootFileEl.classList.add(styleClass.activeFile)
    }
    if (!fileEl.explorerFileEl.classList.contains(styleClass.activeExplorer)) {
      fileEl.explorerFileEl.classList.add(styleClass.activeExplorer)
    }
  }

  deselectFileEl(fileEl: MappedFileElement): void {
    if (fileEl.rootFileEl.classList.contains(styleClass.activeFile)) {
      fileEl.rootFileEl.classList.remove(styleClass.activeFile)
    }
    if (fileEl.explorerFileEl.classList.contains(styleClass.activeExplorer)) {
      fileEl.explorerFileEl.classList.remove(styleClass.activeExplorer)
    }
  }

  selectFilterEl(filterEl: FilePathFilter): void {
    if (!filterEl.explorerFilterEl.classList.contains(styleClass.activeExplorer)) {
      filterEl.explorerFilterEl.classList.add(styleClass.activeExplorer)
    }
  }

  deselectFilterEl(filterEl: FilePathFilter): void {
    if (filterEl.explorerFilterEl.classList.contains(styleClass.activeExplorer)) {
      filterEl.explorerFilterEl.classList.remove(styleClass.activeExplorer)
    }
  }

  isFilterSelected(name: string): boolean {
    return this._selectedFilters.has(name)
  }

  isFileSelected(path: string): boolean {
    return this._selectedFilePaths.has(path)
  }

  updateActiveFileElements(): void {
    this._filters.forEach((el, idx) => {
      if (this.isFilterSelected(el.name)) {
        this.selectFilterEl(el)
      } else {
        this.deselectFilterEl(el)
      }
    })
    this._mappedFileEls.forEach( (el, idx) => {
      if (this.isFileSelected(el.path)) {
        this.selectFileEl(el)
      } else {
        this.deselectFileEl(el)
      }
    })
  }

  updateViewedFileStatus(file: MappedFileElement): void {
    Logger.log('[updateViewedFileStatus] Updating files viewed status: ', file)

    if (file.isViewed) {
      file.explorerFileEl.classList.add(styleClass.viewedExplorer)
    } else {
      file.explorerFileEl.classList.remove(styleClass.viewedExplorer)
    }
  }

  isViewedFile(fileHeader: HTMLElement): boolean {
    const rootFileHeaderViewedCheckbox = fileHeader.getElementsByClassName('js-reviewed-checkbox')[0] as HTMLElement

    Logger.log('[isViewedFile] Checking checkbox value: ', rootFileHeaderViewedCheckbox)

    const isViewedStatus = rootFileHeaderViewedCheckbox.getAttribute('data-ga-click')

    Logger.log('[isViewedFile] Checking viewed status: ', isViewedStatus)

    return isViewedStatus?.includes('true') ?? false
  }

  cleanupLoadingEl(): void {
    if (!this._loadingEl) {
      return
    }

    this._loadingEl.remove()
    this._loadingEl = null
  }
}