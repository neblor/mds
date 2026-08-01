/** lucide-solid 深路径（.jsx 源码）无类型声明，这里补最小类型 */
declare module "lucide-solid/dist/source/icons/*.jsx" {
	import type { JSX } from "solid-js";
	interface IconProps extends JSX.SvgSVGAttributes<SVGSVGElement> {
		size?: number | string;
		strokeWidth?: number | string;
	}
	const Icon: (props: IconProps) => JSX.Element;
	export default Icon;
}
