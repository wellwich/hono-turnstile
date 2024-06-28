import { JSX, forwardRef } from 'hono/jsx'

type ComponentProps<Tag> = Tag extends keyof JSX.IntrinsicElements
	? JSX.IntrinsicElements[Tag] & { as?: Tag }
	: Record<string, unknown> & { as: Tag };

const Component = <Tag extends string = 'div'>(
	{ as: Element = 'div', ...props }: ComponentProps<Tag>,
	ref: any
) => {
	return <Element {...props} ref={ref} />
}

export default forwardRef(Component)