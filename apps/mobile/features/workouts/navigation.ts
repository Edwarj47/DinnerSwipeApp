import { BottomTabBarProps } from "@react-navigation/bottom-tabs";

export function workoutTabBarProps(props: BottomTabBarProps, workouts: boolean): BottomTabBarProps {
  if (!workouts) return props;
  const active = props.state.routes[props.state.index];
  const routes = props.state.routes.filter(route => route.name !== "grocery");
  return { ...props, state: { ...props.state, routes, index: Math.max(0, routes.findIndex(route => route.key === active?.key)) } };
}
