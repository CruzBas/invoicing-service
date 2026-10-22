/** The consumer behind the API key of the current request. */
export interface AuthenticatedClient {
  id: string;
  name: string;
  emitterIds: string[];
}
