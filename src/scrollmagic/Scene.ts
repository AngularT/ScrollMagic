import { ContainerManager } from './ContainerManager';
import EventDispatcher from './EventDispatcher';
import * as Options from './Options';
import ScrollMagicEvent, { ScrollMagicEventType } from './ScrollMagicEvent';
import { getPixelDistance as getPixelValue } from './util/getRelativeDistance';
import pickDifferencesFlat from './util/pickDifferencesFlat';
import { pickRelevantProps, pickRelevantValues } from './util/pickRelevantInfo';
import { numberToPercString } from './util/transformers';
import { isWindow } from './util/typeguards';
import validateObject from './util/validateObject';
import ViewportObserver, { defaultViewportObserverMargin } from './ViewportObserver';

export { Public as ScrollMagicOptions } from './Options';

// used for listeners to allow the value to be passed in either from the enum or as a string literal
type EventTypeEnumOrUnion = ScrollMagicEventType | `${ScrollMagicEventType}`;
export class Scene {
	public readonly name = 'ScrollMagic';

	private static defaultOptionsPublic = Options.defaults;

	private dispatcher = new EventDispatcher();
	private containerCache = new ContainerManager(this);
	private viewportObserver?: ViewportObserver;

	private optionsPublic: Options.Public = Scene.defaultOptionsPublic;
	private optionsPrivate!: Options.Private; // set in modify in constructor
	private active?: boolean;
	private currentProgress = 0;

	// TODO: currently options.element isn't optional. Can we make it?
	constructor(options: Partial<Options.Public> = {}) {
		const initOptions: Options.Public = {
			...Scene.defaultOptionsPublic,
			...options,
		};
		this.modify(initOptions);
		/**
		 * 
		 * for below setters: for changes always check if they actually do change
		 // TODO: Basicaly add IC and keep the rootMargin up to date.
		 * - add IntersectionController (IC), listening to elem ✅
		 * - trigger callbacks on enter & leave ✅
		 * - add trackStart and trackEnd options ✅
		 *   - validate (start > end) ✅
		 * - recreate IC when trackStart or trackEnd is set (setter) ✅
		 * - introduce offset (getter, setter) ✅
		 * - when offset changes:
		 * 	 - recreate IC ✅
		 *   - if (offset !== 0):
		 *      - use calculated px rootMargin based on trackStart, offset & current viewport height/width
		 * 		- listen for container resizes -> recreate IC
		 * - introduce height (getter, setter)
		 * - when height changes:
		 *   - recreate IC
		 * 	 - if (height !== 100% aber relativ (%)):
		 * 		- add ResizeObserver for element, recreate IC on height/width change
		 * - test all
		 * - next big thing: calclate progress during scene
		 */
	}

	public modify(options: Partial<Options.Public>): Scene {
		const normalized = validateObject(options, Options.validationRules);

		const changed =
			undefined === this.optionsPrivate // internal options not set on first run, so all changed
				? normalized
				: pickDifferencesFlat(normalized, this.optionsPrivate);
		const changedOptions = Object.keys(changed) as Array<keyof Options.Private>;

		this.optionsPublic = {
			...this.optionsPublic,
			...options,
		};
		this.optionsPrivate = {
			...this.optionsPrivate,
			...normalized,
		};

		if (changedOptions.includes('scrollParent')) {
			this.containerCache.attach(this.optionsPrivate.scrollParent).onUpdate(() => {
				// todo: listen to something on cache instead? and also don't forget to unsubscribe. maybe the manager even does that?
				this.update();
			});
		}

		// if the options change we always have to refresh the viewport observer
		this.refreshViewportObserver();
		return this;
	}

	private setActive(newActiveState: boolean) {
		if (newActiveState === this.active) {
			return; // boring.
		}
		const isInitialLeave = undefined === this.active && !newActiveState; // for the initial set to false there's no need to do anything
		this.active = newActiveState;
		if (isInitialLeave) {
			return;
		}
		const type = this.active ? ScrollMagicEventType.Enter : ScrollMagicEventType.Leave;
		this.dispatcher.dispatchEvent(new ScrollMagicEvent(type, this));
		this.update();
	}

	private update() {
		if (!this.active) {
			return;
		}
		const { vertical, trackEnd, trackStart, element } = this.optionsPrivate;
		// todo: remember element resizes...

		const { size: elemSize, start: elemStart } = pickRelevantValues(element.getBoundingClientRect(), vertical);
		const { size: containerSize } = pickRelevantValues(this.containerCache.container.info.size, vertical);

		const positionStart = elemStart / containerSize;
		const positionEnd = (elemStart + elemSize) / containerSize;
		const trackSize = trackStart - trackEnd;
		const total = positionEnd - positionStart + trackSize;
		const passed = trackStart - positionStart;
		const progress = Math.min(Math.max(passed / total, 0), 1); // when leaving, it will overshoot, this normalises to 0 / 1
		if (progress !== this.currentProgress) {
			this.currentProgress = progress;
			this.dispatcher.dispatchEvent(new ScrollMagicEvent(ScrollMagicEventType.Progress, this));
		}
	}

	private calculateMargin() {
		// todo: memoize all this? Might not be worth it...
		// TODO: cache getBoundingClientRect on resize with resize observer!!!
		const { vertical, trackEnd, trackStart, offset, element, height } = this.optionsPrivate;
		const { start, end } = pickRelevantProps(vertical);
		const { size: elemSize } = pickRelevantValues(element.getBoundingClientRect(), vertical);
		const { size: containerSize } = pickRelevantValues(this.containerCache.container.info.size, vertical);

		const trackStartMargin = trackStart - 1; // distance from bottom
		const trackEndMargin = -trackEnd; // distance from top
		const relativeOffset = getPixelValue(offset, elemSize) / containerSize;
		// TODO: fix height
		const relativeHeight = 0; //getPixelValue(height, elementSize) / containerSize;

		// the start and end values are intentionally flipped here (start value defines end margin and vice versa)
		return {
			...defaultViewportObserverMargin,
			[end]: numberToPercString(trackStartMargin - relativeOffset),
			[start]: numberToPercString(trackEndMargin + relativeHeight),
		};
	}

	private refreshViewportObserver(): void {
		const { scrollParent } = this.optionsPrivate;
		const observerOptions = {
			margin: this.calculateMargin(),
			root: isWindow(scrollParent) ? null : scrollParent,
		};

		if (undefined === this.viewportObserver) {
			this.viewportObserver = new ViewportObserver((intersecting, target) => {
				if (target === this.optionsPrivate.element) {
					// this should always be the case, as we only ever observe one element, but you can never be too sure, I guess...
					this.setActive(intersecting);
				}
			}, observerOptions).observe(this.optionsPrivate.element);
		} else {
			this.viewportObserver.updateOptions(observerOptions);
		}
	}

	// getter / setter
	public set element(element: Options.Public['element']) {
		this.modify({ element });
	}
	public get element(): Options.Public['element'] {
		return this.optionsPublic.element;
	}
	public set scrollParent(scrollParent: Options.Public['scrollParent']) {
		this.modify({ scrollParent });
	}
	public get scrollParent(): Options.Public['scrollParent'] {
		return this.optionsPublic.scrollParent;
	}
	public set vertical(vertical: Options.Public['vertical']) {
		this.modify({ vertical });
	}
	public get vertical(): Options.Public['vertical'] {
		return this.optionsPublic.vertical;
	}
	public set trackStart(trackStart: Options.Public['trackStart']) {
		this.modify({ trackStart });
	}
	public get trackStart(): Options.Public['trackStart'] {
		return this.optionsPublic.trackStart;
	}
	public set trackEnd(trackEnd: Options.Public['trackEnd']) {
		this.modify({ trackEnd });
	}
	public get trackEnd(): Options.Public['trackEnd'] {
		return this.optionsPublic.trackEnd;
	}
	public set offset(offset: Options.Public['offset']) {
		this.modify({ offset });
	}
	public get offset(): Options.Public['offset'] {
		return this.optionsPublic.offset;
	}
	public get progress(): number {
		return this.currentProgress;
	}
	public static default(options: Partial<Options.Public> = {}): Options.Public {
		validateObject(options, Options.validationRules);
		this.defaultOptionsPublic = {
			...this.defaultOptionsPublic,
			...options,
		};
		return this.defaultOptionsPublic;
	}

	// event listener
	public on(type: EventTypeEnumOrUnion, cb: (e: ScrollMagicEvent) => void): Scene {
		this.dispatcher.addEventListener(type as ScrollMagicEventType, cb);
		return this;
	}
	public off(type: EventTypeEnumOrUnion, cb: (e: ScrollMagicEvent) => void): Scene {
		this.dispatcher.removeEventListener(type as ScrollMagicEventType, cb);
		return this;
	}
	// same as on, but returns a function to reverse the effect (remove the listener).
	public subscribe(type: EventTypeEnumOrUnion, cb: (e: ScrollMagicEvent) => void): () => void {
		return this.dispatcher.addEventListener(type as ScrollMagicEventType, cb);
	}

	public destroy(): void {
		this.viewportObserver?.disconnect();
		this.containerCache.detach();
	}
}
