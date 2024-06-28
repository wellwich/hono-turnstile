import {
	forwardRef,
	useCallback,
	useEffect,
	useImperativeHandle,
	useMemo,
	useRef,
	useState
} from 'hono/jsx'
import Container from './container'
import { RenderOptions, TurnstileInstance, TurnstileProps } from './types'
import useObserveScript from './use-observe-script'
import {
	CONTAINER_STYLE_SET,
	DEFAULT_CONTAINER_ID,
	DEFAULT_ONLOAD_NAME,
	DEFAULT_SCRIPT_ID,
	getTurnstileSizeOpts,
	injectTurnstileScript
} from './utils'

let turnstileState: 'unloaded' | 'loading' | 'ready' = 'unloaded'

let turnstileLoad: {
	resolve: (value?: unknown) => void
	reject: (reason?: unknown) => void
}

const turnstileLoadPromise = new Promise((resolve, reject) => {
	turnstileLoad = { resolve, reject }
	if (turnstileState === 'ready') resolve(undefined)
})

const ensureTurnstile = (onLoadCallbackName = DEFAULT_ONLOAD_NAME) => {
	if (turnstileState === 'unloaded') {
		turnstileState = 'loading'
		window[onLoadCallbackName] = () => {
			turnstileLoad.resolve()
			turnstileState = 'ready'
			delete window[onLoadCallbackName]
		}
	}
	return turnstileLoadPromise
}

export const Turnstile = forwardRef<TurnstileInstance | undefined, TurnstileProps>((props, ref) => {
	const {
		scriptOptions,
		options = {},
		siteKey,
		onWidgetLoad,
		onSuccess,
		onExpire,
		onError,
		onBeforeInteractive,
		onAfterInteractive,
		onUnsupported,
		onLoadScript,
		id,
		style,
		as = 'div',
		injectScript = true,
		...divProps
	} = props
	const widgetSize = options.size || 'normal'

	const [containerStyle, setContainerStyle] = useState(
		options.execution === 'execute'
			? CONTAINER_STYLE_SET.invisible
			: options.appearance === 'interaction-only'
				? CONTAINER_STYLE_SET.interactionOnly
				: CONTAINER_STYLE_SET[widgetSize]
	)
	const containerRef = useRef<HTMLElement | null>(null)
	const [turnstileLoaded, setTurnstileLoaded] = useState(false)
	const widgetId = useRef<string | undefined | null>(null)
	const widgetSolved = useRef(false)
	const containerId = id || DEFAULT_CONTAINER_ID

	const scriptId = scriptOptions?.id || DEFAULT_SCRIPT_ID
	const scriptLoaded = useObserveScript(scriptId)
	const onLoadCallbackName = scriptOptions?.onLoadCallbackName || DEFAULT_ONLOAD_NAME

	const appearance = options.appearance || 'always'

	const renderConfig = useMemo(
		(): RenderOptions => ({
			sitekey: siteKey,
			action: options.action,
			cData: options.cData,
			callback: token => {
				widgetSolved.current = true
				onSuccess?.(token)
			},
			'error-callback': onError,
			'expired-callback': onExpire,
			'before-interactive-callback': onBeforeInteractive,
			'after-interactive-callback': onAfterInteractive,
			'unsupported-callback': onUnsupported,
			theme: options.theme || 'auto',
			language: options.language || 'auto',
			tabindex: options.tabIndex,
			'response-field': options.responseField,
			'response-field-name': options.responseFieldName,
			size: getTurnstileSizeOpts(widgetSize),
			retry: options.retry || 'auto',
			'retry-interval': options.retryInterval || 8000,
			'refresh-expired': options.refreshExpired || 'auto',
			execution: options.execution || 'render',
			appearance: options.appearance || 'always'
		}),
		[
			options.action,
			options.appearance,
			options.cData,
			options.execution,
			options.language,
			options.refreshExpired,
			options.responseField,
			options.responseFieldName,
			options.retry,
			options.retryInterval,
			options.tabIndex,
			options.theme,
			siteKey,
			widgetSize
		]
	)

	const checkIfTurnstileLoaded = useCallback(() => {
		return typeof window !== 'undefined' && !!window.turnstile
	}, [])

	useEffect(
		function inject() {
			if (injectScript && !turnstileLoaded) {
				injectTurnstileScript({
					onLoadCallbackName,
					scriptOptions: {
						...scriptOptions,
						id: scriptId
					}
				})
			}
		},
		[injectScript, turnstileLoaded, scriptOptions, scriptId]
	)

	useEffect(function waitForTurnstile() {
		if (turnstileState !== 'ready') {
			ensureTurnstile(onLoadCallbackName)
				.then(() => setTurnstileLoaded(true))
				.catch(console.error)
		}
	}, [])

	useEffect(
		function renderWidget() {
			if (!containerRef.current) return
			if (!turnstileLoaded) return
			let cancelled = false

			const render = async () => {
				if (cancelled || !containerRef.current) return
				const id = window.turnstile!.render(containerRef.current, renderConfig)
				widgetId.current = id
				if (widgetId.current) onWidgetLoad?.(widgetId.current)
			}

			render()

			return () => {
				cancelled = true
				if (widgetId.current) window.turnstile!.remove(widgetId.current)
			}
		},
		[containerId, turnstileLoaded, renderConfig]
	)

	ref && useImperativeHandle(
		ref,
		() => {
			const { turnstile } = window
			return {
				getResponse() {
					if (!turnstile?.getResponse || !widgetId.current || !checkIfTurnstileLoaded()) {
						console.warn('Turnstile has not been loaded')
						return
					}

					return turnstile.getResponse(widgetId.current)
				},

				async getResponsePromise(timeout = 30000, retry = 100) {
					return new Promise((resolve, reject) => {
						let timeoutId: ReturnType<typeof setTimeout> | undefined

						const checkLoaded = async () => {
							if (widgetSolved.current && window.turnstile && widgetId.current) {
								try {
									const token = window.turnstile.getResponse(widgetId.current)
									if (timeoutId) clearTimeout(timeoutId)

									if (token) {
										return resolve(token)
									}

									return reject(new Error('No response received'))
								} catch (error) {
									if (timeoutId) clearTimeout(timeoutId)
									console.warn('Failed to get response', error)
									return reject(new Error('Failed to get response'))
								}
							}

							if (!timeoutId) {
								timeoutId = setTimeout(() => {
									if (timeoutId) clearTimeout(timeoutId)
									reject(new Error('Timeout'))
								}, timeout)
							}

							await new Promise(resolve => setTimeout(resolve, retry))
							await checkLoaded()
						}

						checkLoaded()
					})
				},

				reset() {
					if (!turnstile?.reset || !widgetId.current || !checkIfTurnstileLoaded()) {
						console.warn('Turnstile has not been loaded')
						return
					}

					if (options.execution === 'execute') {
						setContainerStyle(CONTAINER_STYLE_SET.invisible)
					}

					try {
						widgetSolved.current = false
						turnstile.reset(widgetId.current)
					} catch (error) {
						console.warn(`Failed to reset Turnstile widget ${widgetId}`, error)
					}
				},

				remove() {
					if (!turnstile?.remove || !widgetId.current || !checkIfTurnstileLoaded()) {
						console.warn('Turnstile has not been loaded')
						return
					}

					setContainerStyle(CONTAINER_STYLE_SET.invisible)
					widgetSolved.current = false
					turnstile.remove(widgetId.current)
					widgetId.current = null
				},

				render() {
					if (
						!turnstile?.render ||
						!containerRef.current ||
						!checkIfTurnstileLoaded() ||
						widgetId.current
					) {
						console.warn('Turnstile has not been loaded or container not found')
						return
					}

					const id = turnstile.render(containerRef.current, renderConfig)
					widgetId.current = id
					if (widgetId.current) onWidgetLoad?.(widgetId.current)

					if (options.execution !== 'execute') {
						setContainerStyle(CONTAINER_STYLE_SET[widgetSize])
					}

					return id
				},

				execute() {
					if (options.execution !== 'execute') {
						console.warn('Execution mode is not set to "execute"')
						return
					}

					if (
						!turnstile?.execute ||
						!containerRef.current ||
						!widgetId.current ||
						!checkIfTurnstileLoaded()
					) {
						console.warn('Turnstile has not been loaded or container not found')
						return
					}

					turnstile.execute(containerRef.current, renderConfig)
					setContainerStyle(CONTAINER_STYLE_SET[widgetSize])
				},

				isExpired() {
					if (!turnstile?.isExpired || !widgetId.current || !checkIfTurnstileLoaded()) {
						console.warn('Turnstile has not been loaded')
						return
					}

					return turnstile.isExpired(widgetId.current)
				}
			}
		},
		[
			widgetId,
			options.execution,
			widgetSize,
			renderConfig,
			containerRef,
			checkIfTurnstileLoaded,
			turnstileLoaded,
			onWidgetLoad
		]
	)

	/* Set the turnstile as loaded, in case the onload callback never runs. (e.g., when manually injecting the script without specifying the `onload` param) */
	useEffect(() => {
		if (scriptLoaded && !turnstileLoaded && window.turnstile) {
			setTurnstileLoaded(true)
		}
	}, [turnstileLoaded, scriptLoaded])

	// Update style
	useEffect(() => {
		setContainerStyle(
			options.execution === 'execute'
				? CONTAINER_STYLE_SET.invisible
				: appearance === 'interaction-only'
					? CONTAINER_STYLE_SET.interactionOnly
					: CONTAINER_STYLE_SET[widgetSize]
		)
	}, [options.execution, widgetSize, appearance])

	// onLoadScript callback
	useEffect(() => {
		if (!scriptLoaded || typeof onLoadScript !== 'function') return
		onLoadScript()
	}, [scriptLoaded])

	return (
		<Container
			ref={containerRef}
			as={as}
			id={containerId}
			style={{ ...containerStyle, ...style }}
			{...divProps}
		/>
	)
})

export default Turnstile
