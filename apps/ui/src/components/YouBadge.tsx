import { JSX } from "solid-js";

export function YouBadge(props: JSX.HTMLAttributes<HTMLSpanElement>) {
  return (
    <span
      class="bg-blue-500 text-white px-2 py-1 rounded-full text-xs ml-2"
      {...props}
    >
      It's you
    </span>
  );
}
