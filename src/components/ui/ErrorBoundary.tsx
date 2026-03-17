"use client";

import React, { ReactNode } from "react";
import { logger } from "@/lib/logging/logger";

interface ErrorBoundaryProps {
  children: ReactNode;
  fallback?: ReactNode;
}

interface ErrorBoundaryState {
  hasError: boolean;
  error: Error | null;
}

/**
 * Error boundary component for graceful error handling
 * Catches errors in child components and displays fallback UI
 */
export class ErrorBoundary extends React.Component<
  ErrorBoundaryProps,
  ErrorBoundaryState
> {
  constructor(props: ErrorBoundaryProps) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: React.ErrorInfo) {
    logger.error("Error caught by boundary", error, {
      componentStack: errorInfo.componentStack,
    });
  }

  render() {
    if (this.state.hasError) {
      return (
        this.props.fallback || (
          <div className="flex h-full items-center justify-center bg-red-50 p-4">
            <div className="space-y-4 text-center">
              <div className="text-lg font-semibold text-red-900">
                Something went wrong
              </div>
              <p className="text-sm text-red-700">
                {this.state.error?.message ||
                  "An unexpected error occurred in the editor"}
              </p>
              <button
                onClick={() => this.setState({ hasError: false, error: null })}
                className="rounded bg-red-900 px-4 py-2 text-sm text-white hover:bg-red-800"
              >
                Try Again
              </button>
            </div>
          </div>
        )
      );
    }

    return this.props.children;
  }
}
