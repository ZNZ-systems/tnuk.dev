import { Component, type ErrorInfo, type ReactNode } from "react";

type Props = {
  children: ReactNode;
  label?: string;
  fallback?: ReactNode;
};
type State = { error: Error | null };

export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error(this.props.label ?? "ErrorBoundary", error, info.componentStack);
  }

  render() {
    if (this.state.error) {
      if (this.props.fallback !== undefined && this.props.fallback !== null) {
        return this.props.fallback;
      }
      return (
        <main className="app-main app-main--narrow">
          <h1>Something went wrong</h1>
          <p className="activate-form__message activate-form__message--error">
            {this.state.error.message}
          </p>
        </main>
      );
    }

    return this.props.children;
  }
}
