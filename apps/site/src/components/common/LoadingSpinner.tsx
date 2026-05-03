import { Center, Loader } from "@mantine/core";

export function LoadingSpinner() {
  return (
    <Center py={64}>
      <Loader size="sm" aria-label="Loading" />
    </Center>
  );
}
