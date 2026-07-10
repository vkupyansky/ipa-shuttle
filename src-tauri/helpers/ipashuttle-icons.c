#include <errno.h>
#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

#include <libimobiledevice/libimobiledevice.h>
#include <libimobiledevice/sbservices.h>

static void usage(void) {
  fprintf(stderr, "usage: ipashuttle-icons --bundle-id <bundle-id> --output <path> [--udid <udid>]\n");
}

static int write_png(const char *path, const char *data, uint64_t size) {
  FILE *file = fopen(path, "wb");
  if (!file) {
    fprintf(stderr, "failed to open output: %s\n", strerror(errno));
    return 1;
  }

  size_t written = fwrite(data, 1, (size_t)size, file);
  if (written != (size_t)size) {
    fprintf(stderr, "failed to write icon png\n");
    fclose(file);
    return 1;
  }

  if (fclose(file) != 0) {
    fprintf(stderr, "failed to close output: %s\n", strerror(errno));
    return 1;
  }

  return 0;
}

int main(int argc, char **argv) {
  const char *bundle_id = NULL;
  const char *output = NULL;
  const char *udid = NULL;

  for (int index = 1; index < argc; index++) {
    if (strcmp(argv[index], "--bundle-id") == 0 && index + 1 < argc) {
      bundle_id = argv[++index];
    } else if (strcmp(argv[index], "--output") == 0 && index + 1 < argc) {
      output = argv[++index];
    } else if (strcmp(argv[index], "--udid") == 0 && index + 1 < argc) {
      udid = argv[++index];
    } else {
      usage();
      return 2;
    }
  }

  if (!bundle_id || !output) {
    usage();
    return 2;
  }

  idevice_t device = NULL;
  idevice_error_t device_error = idevice_new(&device, udid);
  if (device_error != IDEVICE_E_SUCCESS || !device) {
    fprintf(stderr, "could not connect to iPhone\n");
    return 3;
  }

  sbservices_client_t client = NULL;
  sbservices_error_t service_error =
      sbservices_client_start_service(device, &client, "IPA Shuttle");
  if (service_error != SBSERVICES_E_SUCCESS || !client) {
    fprintf(stderr, "could not start SpringBoardServices\n");
    idevice_free(device);
    return 4;
  }

  char *pngdata = NULL;
  uint64_t pngsize = 0;
  service_error = sbservices_get_icon_pngdata(client, bundle_id, &pngdata, &pngsize);
  if (service_error != SBSERVICES_E_SUCCESS || !pngdata || pngsize == 0) {
    fprintf(stderr, "icon unavailable\n");
    sbservices_client_free(client);
    idevice_free(device);
    return 5;
  }

  int result = write_png(output, pngdata, pngsize);
  free(pngdata);
  sbservices_client_free(client);
  idevice_free(device);

  return result;
}
