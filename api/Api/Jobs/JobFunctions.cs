using Bfs.Seed.Storage;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc;
using Microsoft.Azure.Functions.Worker;
using Microsoft.Extensions.Logging;

namespace Api.Jobs;

/// <summary>
/// Beispiel für das Feature storage: Ein Endpunkt stellt einen Job in die Queue, eine
/// Queue-Function verarbeitet ihn und hält den Status in einer Tabelle fest, die der
/// Endpunkt <c>GET /api/jobs/{id}</c> liest. Ohne Feature storage sind die Functions per
/// App-Setting abgeschaltet (infra/storage.tf).
/// </summary>
public sealed class JobFunctions(ISeedTableRepository<JobStatus> jobs, ISeedQueueSender queue, ILogger<JobFunctions> logger)
{
    /// <summary>Queue aus project.yaml (storage.queues).</summary>
    public const string QueueName = "jobs";

    [Function("CreateJob")]
    public async Task<IActionResult> Create(
        [HttpTrigger(AuthorizationLevel.Anonymous, "post", Route = "jobs")] HttpRequest request,
        CancellationToken cancellationToken)
    {
        var body = await request.ReadFromJsonAsync<JobRequest>(cancellationToken);
        if (string.IsNullOrWhiteSpace(body?.Input) || body.Input.Length > 1000)
        {
            return new BadRequestObjectResult(new { error = "input: 1 bis 1000 Zeichen" });
        }

        var job = new JobStatus { PartitionKey = Owner(request), RowKey = Guid.NewGuid().ToString("N"), Input = body.Input };
        await jobs.AddAsync(job, cancellationToken);

        // Erst der Status, dann die Nachricht: So findet die Queue-Function den Datensatz immer vor.
        await queue.SendAsync(QueueName, new JobMessage(job.PartitionKey, job.RowKey), cancellationToken: cancellationToken);

        return new AcceptedResult($"/api/jobs/{job.RowKey}", JobResponse.From(job));
    }

    [Function("GetJob")]
    public async Task<IActionResult> Get(
        [HttpTrigger(AuthorizationLevel.Anonymous, "get", Route = "jobs/{id}")] HttpRequest request,
        string id,
        CancellationToken cancellationToken)
    {
        // Nur in der eigenen Partition: Fremde Jobs sind nicht auffindbar, auch mit bekannter ID.
        var job = Guid.TryParseExact(id, "N", out _) ? await jobs.GetAsync(Owner(request), id, cancellationToken) : null;
        return job is null ? new NotFoundResult() : new OkObjectResult(JobResponse.From(job));
    }

    /// <summary>
    /// Queue-Nachrichten kommen mindestens einmal an. Schlägt die Verarbeitung fehl, liefert die
    /// Queue sie erneut (host.json: maxDequeueCount, visibilityTimeout); danach landet sie in
    /// der Poison-Queue jobs-poison und der Job bleibt auf failed.
    /// </summary>
    [Function("ProcessJob")]
    public async Task Process(
        [QueueTrigger(QueueName, Connection = SeedStorageOptions.ConnectionName)] JobMessage message,
        CancellationToken cancellationToken)
    {
        // Erledigte Jobs nicht noch einmal anfassen; ModifyAsync schreibt mit ETag.
        var job = await jobs.ModifyAsync(message.PartitionKey, message.JobId, j =>
        {
            if (j.Status == JobStatus.Done)
            {
                return false;
            }

            j.Status = JobStatus.Running;
            j.Attempts++;
            return true;
        }, cancellationToken);

        if (job is null || job.Status == JobStatus.Done)
        {
            return;
        }

        try
        {
            // Platzhalter für die eigentliche Arbeit.
            var result = job.Input.ToUpperInvariant();

            await jobs.ModifyAsync(message.PartitionKey, message.JobId, j =>
            {
                j.Status = JobStatus.Done;
                j.Result = result;
                return true;
            }, cancellationToken);
        }
        catch (Exception e) when (e is not OperationCanceledException)
        {
            logger.LogError(e, "Job {JobId} fehlgeschlagen (Versuch {Attempt})", message.JobId, job.Attempts);
            await jobs.ModifyAsync(message.PartitionKey, message.JobId, j =>
            {
                j.Status = JobStatus.Failed;
                j.Result = null;
                return true;
            }, cancellationToken);

            // Weiterwerfen, damit die Queue die Nachricht erneut liefert.
            throw;
        }
    }

    /// <summary>
    /// Mit sso gehört jeder Job der angemeldeten Person (PartitionKey = oid). Ohne sso ist die
    /// API offen; dann teilen sich alle eine Partition.
    /// </summary>
    private static string Owner(HttpRequest request) =>
        request.HttpContext.User.Identity?.IsAuthenticated == true
            ? SeedPartitionKeys.ForUser(request.HttpContext.User)
            : "anonymous";
}
