import React from 'react';
import type { ReactNode } from 'react';

interface Props {
  children: ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
}

export class ErrorBoundary extends React.Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error) {
    console.error('Error Boundary caught:', error);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="min-h-screen bg-red-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-lg shadow-xl p-8 max-w-md w-full">
            <div className="text-5xl mb-4">❌</div>
            <h1 className="text-2xl font-bold text-red-700 mb-2">Oops! Something went wrong</h1>
            <p className="text-gray-600 mb-4">
              We encountered an unexpected error. Please try refreshing the page.
            </p>
            <div className="bg-red-100 border-l-4 border-red-600 p-4 mb-4 rounded text-sm text-red-800 font-mono break-words">
              {this.state.error?.message || 'Unknown error'}
            </div>
            <button
              onClick={() => window.location.href = '/'}
              className="w-full px-4 py-3 bg-blue-600 text-white font-bold rounded-lg hover:bg-blue-700 transition"
            >
              Return to Home
            </button>
            <button
              onClick={() => window.location.reload()}
              className="w-full px-4 py-3 mt-2 bg-gray-300 text-gray-800 font-bold rounded-lg hover:bg-gray-400 transition"
            >
              Refresh Page
            </button>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}
