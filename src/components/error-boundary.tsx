'use client';
   
import { Component, ErrorInfo, ReactNode } from 'react';

interface Props {
  children: ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
}

export class ErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { hasError: false, error: null };
  }
  
  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }
  
  componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error('🔥 Caught error:', error);
    console.error('📍 Error info:', errorInfo);
  }
  
  render() {
    if (this.state.hasError) {
      return (
        <div className="p-8 text-destructive">
          <h2 className="text-xl font-bold">Something went wrong</h2>
          <pre className="mt-4 p-4 bg-muted rounded">
            {this.state.error?.toString()}
          </pre>
        </div>
      );
    }
    
    return this.props.children;
  }
}
